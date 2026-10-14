package app.macrai.android.ui.catalog

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.macrai.android.MacrAIApplication
import app.macrai.android.ui.chat.SourceBadge
import app.macrai.android.ui.theme.FigureStyle
import app.macrai.android.ui.theme.LocalMacroColors
import app.macrai.core.FoodProfile
import app.macrai.core.MIN_MATCH_SCORE
import app.macrai.core.bestScore
import app.macrai.core.formatNumber
import app.macrai.core.importCatalog
import app.macrai.core.parseCatalogMarkdown
import app.macrai.core.newId
import app.macrai.core.upsertFood
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// "Catálogo": los valores de cada usuario con su fuente (E etiqueta, U tuyo, Web, Est).
// Se busca con el mismo emparejado tolerante que usa el chat; lo que no esté se puede traer
// de Open Food Facts. Tocar un alimento abre su ficha para corregir valores y alias.

@Composable
fun CatalogScreen(app: MacrAIApplication, modifier: Modifier = Modifier) {
    val state by app.store.flow.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf<FoodProfile?>(null) }
    var results by remember { mutableStateOf<List<FoodProfile>?>(null) }
    var searching by remember { mutableStateOf(false) }
    var importMessage by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current

    // Catálogo en Markdown (como docs/datos/catalogo-inicial.md): no pisa lo que ya tengas.
    val importFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            importMessage = runCatching {
                val text = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                } ?: error("No se pudo leer el archivo")
                val parsed = parseCatalogMarkdown(text)
                var summary = ""
                app.store.update { s ->
                    s.importCatalog(parsed).also {
                        summary = "Importados ${it.added} alimentos y ${it.aliases} alias" +
                            (if (it.skipped > 0) "; ${it.skipped} ya estaban y no se han tocado." else ".")
                    }.state
                }
                summary
            }.getOrElse { "No se pudo importar: ${it.message}" }
        }
    }

    val foods = if (query.isBlank()) state.catalog.sortedBy { it.name }
    else state.catalog.filter { it.bestScore(query) >= MIN_MATCH_SCORE }.sortedByDescending { it.bestScore(query) }

    Column(modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Catálogo", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            TextButton(onClick = { importFile.launch(arrayOf("text/*", "application/octet-stream")) }) { Text("Importar .md") }
        }
        importMessage?.let {
            Text(it, Modifier.padding(bottom = 8.dp), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        OutlinedTextField(
            value = query,
            onValueChange = { query = it; results = null },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Buscar: cottage, jamón, la de Mercadona…") },
            singleLine = true,
            shape = RoundedCornerShape(24.dp),
        )
        if (query.isNotBlank()) {
            OutlinedButton(
                onClick = {
                    searching = true
                    scope.launch {
                        results = runCatching { app.foods.search(query, limit = 10) }.getOrDefault(emptyList())
                        searching = false
                    }
                },
                enabled = !searching,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            ) { Text(if (searching) "Buscando…" else "Buscar «$query» en el catálogo de productos") }
        }

        LazyColumn(Modifier.weight(1f).padding(top = 8.dp)) {
            results?.let { found ->
                item {
                    Text(
                        if (found.isEmpty()) "Sin resultados. Prueba con la marca o fotografía la etiqueta desde el chat."
                        else "En el catálogo de productos",
                        Modifier.padding(vertical = 8.dp),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                items(found.distinctBy { it.id }, key = { "off-" + it.id }) { product ->
                    val inCatalog = state.catalog.any { it.barcode != null && it.barcode == product.barcode }
                    FoodRow(product, trailing = {
                        TextButton(
                            onClick = {
                                scope.launch {
                                    app.store.update { it.upsertFood(product.copy(id = newId())) }
                                }
                            },
                            enabled = !inCatalog,
                        ) { Text(if (inCatalog) "Guardado" else "Añadir") }
                    })
                }
                item { HorizontalDivider(Modifier.padding(vertical = 8.dp), color = MaterialTheme.colorScheme.outline) }
            }

            if (foods.isEmpty() && results == null) {
                item {
                    Text(
                        "Aquí aparecen los alimentos que vayas registrando, las etiquetas que fotografíes y lo que añadas desde Open Food Facts.",
                        Modifier.padding(top = 24.dp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            items(foods, key = { it.id }) { food ->
                FoodRow(food, Modifier.clickable { editing = food }, trailing = { SourceBadge(food.source) })
            }
            item {
                Text(
                    "Productos del catálogo de MacrAI y de Open Food Facts (openfoodfacts.org), licencia ODbL.",
                    Modifier.padding(vertical = 16.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }

    editing?.let { food -> FoodDialog(app, food, onDismiss = { editing = null }) }
}

@Composable
private fun FoodRow(food: FoodProfile, modifier: Modifier = Modifier, trailing: @Composable () -> Unit) {
    val colors = LocalMacroColors.current
    Column(modifier.fillMaxWidth().padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(food.displayName, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
            trailing()
        }
        val m = food.per100
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("${formatNumber(m.kcal)} kcal/100 ${food.basis.unit}", style = FigureStyle)
            Text("P ${formatNumber(m.protein)}", style = FigureStyle, color = colors.protein)
            Text("C ${formatNumber(m.carbs)}", style = FigureStyle, color = colors.carbs)
            Text("G ${formatNumber(m.fat)}", style = FigureStyle, color = colors.fat)
        }
        val extra = listOfNotNull(
            food.unitWeightG?.let { "Unidad: ${formatNumber(it)} g" },
            food.packFormat?.let { "Envase: $it" },
            food.aliases.takeIf { it.isNotEmpty() }?.joinToString(", ", prefix = "También: "),
        )
        if (extra.isNotEmpty()) {
            Text(extra.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
}
