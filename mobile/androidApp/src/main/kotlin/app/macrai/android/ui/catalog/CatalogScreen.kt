package app.macrai.android.ui.catalog

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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.macrai.android.MacrAIApplication
import app.macrai.android.ui.chat.SourceBadge
import app.macrai.android.ui.theme.FigureStyle
import app.macrai.android.ui.theme.LocalMacroColors
import app.macrai.core.MIN_MATCH_SCORE
import app.macrai.core.bestScore
import app.macrai.core.formatNumber

// "Catálogo": los valores que el usuario ha validado, con su fuente (E, U, Web, Est).
// Se busca con el mismo emparejado tolerante que usa el chat.

@Composable
fun CatalogScreen(app: MacrAIApplication, modifier: Modifier = Modifier) {
    val state by app.store.flow.collectAsStateWithLifecycle()
    var query by remember { mutableStateOf("") }
    val foods = if (query.isBlank()) state.catalog.sortedBy { it.name }
    else state.catalog.filter { it.bestScore(query) >= MIN_MATCH_SCORE }.sortedByDescending { it.bestScore(query) }
    val colors = LocalMacroColors.current

    Column(modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        Text("Catálogo", Modifier.padding(vertical = 16.dp), style = MaterialTheme.typography.titleLarge)
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Buscar: cottage, jamón, sopa…") },
            singleLine = true,
            shape = RoundedCornerShape(24.dp),
        )
        if (foods.isEmpty()) {
            Text(
                "Aquí aparecen los alimentos que vayas registrando y las etiquetas que fotografíes.",
                Modifier.padding(top = 24.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        LazyColumn(Modifier.padding(top = 8.dp)) {
            items(foods, key = { it.id }) { food ->
                Column(Modifier.padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(food.displayName, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                        SourceBadge(food.source)
                    }
                    val m = food.per100
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("${formatNumber(m.kcal)} kcal/100 ${food.basis.unit}", style = FigureStyle)
                        Text("P ${formatNumber(m.protein)}", style = FigureStyle, color = colors.protein)
                        Text("C ${formatNumber(m.carbs)}", style = FigureStyle, color = colors.carbs)
                        Text("G ${formatNumber(m.fat)}", style = FigureStyle, color = colors.fat)
                    }
                    food.unitWeightG?.let {
                        Text("Unidad: ${formatNumber(it)} g", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            }
        }
    }
}
