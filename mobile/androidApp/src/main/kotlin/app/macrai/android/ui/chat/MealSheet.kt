package app.macrai.android.ui.chat

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
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
import androidx.compose.ui.unit.dp
import app.macrai.android.MacrAIApplication
import app.macrai.android.ui.common.NumberField
import app.macrai.android.ui.common.asField
import app.macrai.android.ui.common.toNumberOrNull
import app.macrai.android.ui.theme.FigureStyle
import app.macrai.android.ui.theme.LocalMacroColors
import app.macrai.core.LogEntry
import app.macrai.core.Meal
import app.macrai.core.StoreState
import app.macrai.core.dayLabel
import app.macrai.core.deleteEntry
import app.macrai.core.formatGrams
import app.macrai.core.formatKcal
import app.macrai.core.formatNumber
import app.macrai.core.moveEntry
import app.macrai.core.sum
import app.macrai.core.updateEntryGrams
import kotlinx.coroutines.launch

// Control manual del día: lo registrado en una comida, con sus supuestos, y cada entrada se
// puede corregir, mover o borrar sin pasar por el chat. Recalcula con las mismas funciones
// que las correcciones por mensaje.

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MealSheet(app: MacrAIApplication, state: StoreState, meal: Meal, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    val day = state.openDay ?: return
    val entries = state.entriesOf(day).filter { it.meal == meal }.sortedBy { it.loggedAt }
    var editing by remember { mutableStateOf<LogEntry?>(null) }
    val colors = LocalMacroColors.current

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 32.dp)) {
            Text("${meal.label} · ${dayLabel(day)}", style = MaterialTheme.typography.titleLarge)
            if (entries.isEmpty()) {
                Text(
                    "Nada registrado todavía. Díselo al chat: «añade 150 de leche a la ${meal.label.lowercase()}».",
                    Modifier.padding(vertical = 16.dp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            entries.forEach { e ->
                Column(Modifier.fillMaxWidth().clickable { editing = e }.padding(vertical = 12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(e.name, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                        SourceBadge(e.source)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(if (e.grams > 0) formatGrams(e.grams) else "${formatNumber(e.units ?: 1.0)} ud", style = FigureStyle)
                        Text("${formatKcal(e.macros.kcal)} kcal", style = FigureStyle)
                        Text("P ${formatNumber(e.macros.protein)}", style = FigureStyle, color = colors.protein)
                        Text("C ${formatNumber(e.macros.carbs)}", style = FigureStyle, color = colors.carbs)
                        Text("G ${formatNumber(e.macros.fat)}", style = FigureStyle, color = colors.fat)
                    }
                    e.assumptions.forEach {
                        Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            }
            if (entries.size > 1) {
                val total = entries.map { it.macros }.sum()
                Text(
                    "Total: ${formatKcal(total.kcal)} kcal · P ${formatNumber(total.protein)} · C ${formatNumber(total.carbs)} · G ${formatNumber(total.fat)}",
                    Modifier.padding(top = 12.dp),
                    style = FigureStyle,
                )
            }
        }
    }

    editing?.let { e ->
        EntryDialog(
            entry = e,
            onDismiss = { editing = null },
            onSave = { grams, newMeal ->
                scope.launch {
                    app.store.update { s ->
                        val withGrams = if (grams != null && e.grams > 0) s.updateEntryGrams(e.id, grams) else s
                        withGrams.moveEntry(e.id, newMeal)
                    }
                }
                editing = null
            },
            onDelete = {
                scope.launch { app.store.update { it.deleteEntry(e.id) } }
                editing = null
            },
        )
    }
}

@Composable
private fun EntryDialog(
    entry: LogEntry,
    onDismiss: () -> Unit,
    onSave: (grams: Double?, meal: Meal) -> Unit,
    onDelete: () -> Unit,
) {
    var grams by remember { mutableStateOf(entry.grams.takeIf { it > 0 }.asField()) }
    var meal by remember { mutableStateOf(entry.meal) }
    var confirmDelete by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(entry.name) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                // Las entradas por unidad o "solo kcal" no tienen gramos que cambiar.
                if (entry.grams > 0) NumberField("Cantidad", grams, { grams = it }, Modifier.fillMaxWidth(), suffix = "g")
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Meal.entries.forEach { m ->
                        FilterChip(selected = m == meal, onClick = { meal = m }, label = { Text(m.label) })
                    }
                }
                if (confirmDelete) Text("Pulsa otra vez «Borrar» para confirmarlo.", color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            TextButton(onClick = { onSave(grams.toNumberOrNull()?.takeIf { it > 0 }, meal) }) { Text("Guardar") }
        },
        dismissButton = {
            TextButton(onClick = { if (confirmDelete) onDelete() else confirmDelete = true }) {
                Text("Borrar", color = MaterialTheme.colorScheme.error)
            }
        },
    )
}
