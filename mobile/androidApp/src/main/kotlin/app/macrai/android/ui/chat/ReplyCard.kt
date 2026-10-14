package app.macrai.android.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.macrai.android.ui.theme.FigureStyle
import app.macrai.android.ui.theme.LocalMacroColors
import app.macrai.core.AssistantReply
import app.macrai.core.Macros
import app.macrai.core.ReplyBlock
import app.macrai.core.ValueSource
import app.macrai.core.approx
import app.macrai.core.dayLabel
import app.macrai.core.formatGrams
import app.macrai.core.formatKcal
import app.macrai.core.formatNumber
import app.macrai.core.formatSigned

// La respuesta del asistente pintada como un "ticket": el mismo orden fijo de bloques que
// define el documento (qué se añadió → comida → día), con cifras tabulares y la fuente de
// cada valor a la vista. Nada de burbujas de colores ni emojis.

private val CardShape = RoundedCornerShape(16.dp)

@Composable
fun ReplyCard(reply: AssistantReply, modifier: Modifier = Modifier) {
    Column(
        modifier
            .fillMaxWidth()
            .border(1.dp, MaterialTheme.colorScheme.outline, CardShape)
            .background(MaterialTheme.colorScheme.surface, CardShape)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        reply.blocks.forEach { Block(it) }
    }
}

@Composable
private fun Block(block: ReplyBlock) {
    when (block) {
        is ReplyBlock.Title -> Text(block.text, style = MaterialTheme.typography.titleMedium)
        is ReplyBlock.Notes -> Notes(block.lines)
        is ReplyBlock.Foods -> Foods(block.rows)
        is ReplyBlock.MealTotal -> TotalRow(block.meal.label, block.macros, block.estimated, emphasized = false)
        is ReplyBlock.DayTotal -> DayTable(block)
        is ReplyBlock.Change -> ChangeTable(block)
        is ReplyBlock.Balance -> BalanceTable(block)
        is ReplyBlock.Weights -> Column {
            block.rows.forEach { w -> FigureRow(dayLabel(w.day).cap(), "${formatNumber(w.kg)} kg") }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            FigureRow("Media", block.average?.let { "${formatNumber(it, 2)} kg" } ?: "-", bold = true)
        }
        is ReplyBlock.Text -> Text(block.text, style = MaterialTheme.typography.bodyLarge)
        is ReplyBlock.Question -> Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(MaterialTheme.colorScheme.primary, RoundedCornerShape(2.dp)))
            Text(block.text, Modifier.padding(start = 10.dp), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
        }
    }
}

/** Supuestos en gris y con una línea al margen: se ven, pero no compiten con las cifras. */
@Composable
private fun Notes(lines: List<String>) {
    Row(Modifier.height(IntrinsicSize.Min)) {
        Box(Modifier.width(1.dp).fillMaxHeight().background(MaterialTheme.colorScheme.outline))
        Column(Modifier.padding(start = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            lines.forEach { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable
private fun Foods(rows: List<ReplyBlock.FoodRow>) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        rows.forEach { row ->
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(row.name, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                    SourceBadge(row.source)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(row.amount, style = FigureStyle, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("${formatKcal(row.macros.kcal)} kcal", style = FigureStyle)
                    MacroTriplet(row.macros)
                }
            }
        }
    }
}

@Composable
private fun MacroTriplet(m: Macros) {
    val colors = LocalMacroColors.current
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("P ${formatNumber(m.protein)}", style = FigureStyle, color = colors.protein)
        Text("C ${formatNumber(m.carbs)}", style = FigureStyle, color = colors.carbs)
        Text("G ${formatNumber(m.fat)}", style = FigureStyle, color = colors.fat)
    }
}

/** E, U, Web, Est: de dónde sale el valor, como en el catálogo del documento. */
@Composable
fun SourceBadge(source: ValueSource) {
    val (bg, fg) = when (source) {
        ValueSource.LABEL -> MaterialTheme.colorScheme.primary to MaterialTheme.colorScheme.onPrimary
        else -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Text(
        source.code,
        Modifier.background(bg, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 2.dp),
        style = MaterialTheme.typography.labelSmall,
        color = fg,
    )
}

@Composable
private fun TotalRow(label: String, m: Macros?, estimated: Boolean, emphasized: Boolean) {
    val weight = if (emphasized) FontWeight.Bold else FontWeight.Normal
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1.4f), style = MaterialTheme.typography.bodyMedium, fontWeight = weight)
        Cell(m?.let { approx(formatKcal(it.kcal), estimated) } ?: "-", 1f, weight, if (m == null) muted else Color.Unspecified)
        Cell(m?.let { formatGrams(it.protein) } ?: "-", 1f, weight, if (m == null) muted else LocalMacroColors.current.protein)
        Cell(m?.let { formatGrams(it.carbs) } ?: "-", 1f, weight, muted)
        Cell(m?.let { formatGrams(it.fat) } ?: "-", 1f, weight, muted)
    }
}

@Composable
private fun RowScope.Cell(text: String, weight: Float, fontWeight: FontWeight, color: Color) {
    Text(text, Modifier.weight(weight), style = FigureStyle, fontWeight = fontWeight, color = color, textAlign = TextAlign.End)
}

@Composable
private fun DayTable(block: ReplyBlock.DayTotal) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp))
            .padding(12.dp),
    ) {
        val state = if (block.final) "FINAL" else "parcial"
        Text("Total día · ${dayLabel(block.day)}, $state", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Text("", Modifier.weight(1.4f))
            listOf("Kcal", "Prot.", "Carbos", "Grasas").forEach {
                Text(it, Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End)
            }
        }
        block.rows.forEach { TotalRow(it.meal.label, it.macros, estimated = false, emphasized = false) }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        TotalRow("Total", block.total, block.estimated, emphasized = true)
    }
}

@Composable
private fun ChangeTable(block: ReplyBlock.Change) {
    Column {
        Row {
            Text("", Modifier.weight(1.2f))
            Text("Antes", Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.End)
            Text("Ahora", Modifier.weight(1f), style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.End)
        }
        block.rows.forEach { (label, before, after) ->
            Row(Modifier.padding(vertical = 3.dp)) {
                Text(label, Modifier.weight(1.2f), style = MaterialTheme.typography.bodyMedium)
                Text(before, Modifier.weight(1f), style = FigureStyle, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End)
                Text(after, Modifier.weight(1f), style = FigureStyle, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.End)
            }
        }
        block.conclusion?.let { Text(it, Modifier.padding(top = 6.dp), style = MaterialTheme.typography.bodyMedium) }
    }
}

@Composable
private fun BalanceTable(block: ReplyBlock.Balance) {
    Column {
        block.days.forEach { d ->
            Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
                Text(dayLabel(d.day).cap(), Modifier.weight(1.2f), style = MaterialTheme.typography.bodyMedium)
                Text(d.expenditure?.let { formatNumber(it, 0) } ?: "-", Modifier.weight(1f), style = FigureStyle, textAlign = TextAlign.End)
                Text(approx(formatNumber(d.intake, 0), d.estimated), Modifier.weight(1f), style = FigureStyle, textAlign = TextAlign.End)
                Text(d.deficit?.let { formatNumber(it, 0) } ?: "-", Modifier.weight(1f), style = FigureStyle, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.End)
                if (block.showTarget) {
                    Text(d.vsTarget?.let { formatSigned(it) } ?: "-", Modifier.weight(1f), style = FigureStyle, textAlign = TextAlign.End)
                }
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
        FigureRow("Déficit acumulado", "~${formatNumber(block.period.accumulatedDeficit, 0)} kcal", bold = true)
    }
}

@Composable
private fun FigureRow(label: String, value: String, bold: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, fontWeight = if (bold) FontWeight.SemiBold else null)
        Text(value, style = FigureStyle, fontWeight = if (bold) FontWeight.SemiBold else null)
    }
}

internal fun String.cap() = replaceFirstChar { it.uppercase() }
