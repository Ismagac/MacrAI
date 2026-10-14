package app.macrai.android.ui.catalog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.macrai.android.MacrAIApplication
import app.macrai.android.ui.common.NumberField
import app.macrai.android.ui.common.asField
import app.macrai.android.ui.common.toNumberOrNull
import app.macrai.core.FoodProfile
import app.macrai.core.Macros
import app.macrai.core.ValueSource
import app.macrai.core.addAlias
import app.macrai.core.checkLabel
import app.macrai.core.deleteFood
import app.macrai.core.formatKcal
import app.macrai.core.upsertFood
import kotlinx.coroutines.launch

// Ficha de un alimento del catálogo: valores por 100 g/ml, peso por unidad y las formas en
// que el usuario lo llama (alias). Al guardar se recalculan las entradas de la semana que lo
// usan, igual que con una corrección por chat.

@Composable
fun FoodDialog(app: MacrAIApplication, food: FoodProfile, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(food.name) }
    var brand by remember { mutableStateOf(food.brand.orEmpty()) }
    var kcal by remember { mutableStateOf(food.per100.kcal.asField()) }
    var protein by remember { mutableStateOf(food.per100.protein.asField()) }
    var carbs by remember { mutableStateOf(food.per100.carbs.asField()) }
    var fat by remember { mutableStateOf(food.per100.fat.asField()) }
    var unit by remember { mutableStateOf(food.unitWeightG.asField()) }
    var aliases by remember { mutableStateOf(food.aliases) }
    var newAlias by remember { mutableStateOf("") }
    var confirmDelete by remember { mutableStateOf(false) }

    val per100 = Macros(
        kcal.toNumberOrNull() ?: 0.0,
        protein.toNumberOrNull() ?: 0.0,
        carbs.toNumberOrNull() ?: 0.0,
        fat.toNumberOrNull() ?: 0.0,
    )
    val check = checkLabel(per100)
    val unitLabel = food.basis.unit

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Editar alimento") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth(), label = { Text("Nombre") }, singleLine = true)
                OutlinedTextField(brand, { brand = it }, Modifier.fillMaxWidth(), label = { Text("Marca") }, singleLine = true)
                Text("Por 100 $unitLabel", style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    NumberField("Kcal", kcal, { kcal = it }, Modifier.weight(1f))
                    NumberField("Proteína", protein, { protein = it }, Modifier.weight(1f), suffix = "g")
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    NumberField("Carbos", carbs, { carbs = it }, Modifier.weight(1f), suffix = "g")
                    NumberField("Grasas", fat, { fat = it }, Modifier.weight(1f), suffix = "g")
                }
                if (per100.kcal > 0 && !check.consistent) {
                    Text(
                        "Los macros dan ${formatKcal(check.computedKcal)} kcal y has puesto ${formatKcal(check.declaredKcal)}. Revisa la etiqueta.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                NumberField("Peso de una unidad", unit, { unit = it }, Modifier.fillMaxWidth(), suffix = "g")

                Text("Cómo lo llamas", style = MaterialTheme.typography.labelLarge)
                aliases.forEach { alias ->
                    InputChip(
                        selected = false,
                        onClick = { aliases = aliases - alias },
                        label = { Text(alias) },
                        trailingIcon = { Icon(Icons.Outlined.Close, contentDescription = "Quitar alias") },
                    )
                }
                OutlinedTextField(
                    newAlias,
                    { newAlias = it },
                    Modifier.fillMaxWidth(),
                    label = { Text("Nuevo alias, p. ej. «el batido»") },
                    singleLine = true,
                    trailingIcon = {
                        TextButton(
                            onClick = {
                                if (newAlias.isNotBlank() && newAlias.trim() !in aliases) aliases = aliases + newAlias.trim()
                                newAlias = ""
                            },
                        ) { Text("Añadir") }
                    },
                )
                if (confirmDelete) {
                    Text(
                        "Pulsa otra vez «Borrar». Lo ya registrado se queda como está.",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val valuesChanged = per100 != food.per100 || unit.toNumberOrNull() != food.unitWeightG
                    val updated = food.copy(
                        name = name.trim().ifEmpty { food.name },
                        brand = brand.trim().ifEmpty { null },
                        per100 = per100,
                        unitWeightG = unit.toNumberOrNull(),
                        // Un valor tocado a mano pasa a ser dato del usuario (fuente U).
                        source = if (valuesChanged) ValueSource.USER else food.source,
                        macrosEstimated = if (valuesChanged) false else food.macrosEstimated,
                        aliases = emptyList(),
                    )
                    scope.launch {
                        app.store.update { s ->
                            // Los alias pasan por addAlias: si otro alimento tenía el mismo, se mueve aquí.
                            aliases.fold(s.upsertFood(updated)) { acc, alias -> acc.addAlias(updated.id, alias) }
                        }
                    }
                    onDismiss()
                },
            ) { Text("Guardar") }
        },
        dismissButton = {
            TextButton(
                onClick = {
                    if (confirmDelete) {
                        scope.launch { app.store.update { it.deleteFood(food.id) } }
                        onDismiss()
                    } else {
                        confirmDelete = true
                    }
                },
            ) { Text("Borrar", color = MaterialTheme.colorScheme.error) }
        },
    )
}
