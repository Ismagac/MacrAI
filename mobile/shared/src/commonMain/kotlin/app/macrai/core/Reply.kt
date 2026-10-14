package app.macrai.core

import kotlinx.datetime.LocalDate

// Forma fija de cada respuesta (§11.1): qué se añadió → total de esa comida → total del día.
// Es una estructura, no texto: la app la pinta con componentes nativos y Telegram o la web
// la reciben como Markdown con toMarkdown().

sealed interface ReplyBlock {
    data class Title(val text: String) : ReplyBlock

    /** Supuestos y fuente: como mucho tres líneas (§11.3). */
    data class Notes(val lines: List<String>) : ReplyBlock

    data class FoodRow(val name: String, val amount: String, val macros: Macros, val source: ValueSource)

    data class Foods(val rows: List<FoodRow>) : ReplyBlock

    data class MealTotal(val meal: Meal, val macros: Macros, val estimated: Boolean) : ReplyBlock

    data class MealRow(val meal: Meal, val macros: Macros?)

    data class DayTotal(
        val day: LocalDate,
        val rows: List<MealRow>,
        val total: Macros,
        val estimated: Boolean,
        val final: Boolean,
    ) : ReplyBlock

    /** Corrección: qué cambió, antes → ahora (§8). */
    data class Change(val rows: List<Triple<String, String, String>>, val conclusion: String? = null) : ReplyBlock

    data class Balance(val days: List<DayBalance>, val period: PeriodBalance, val showTarget: Boolean) : ReplyBlock

    data class Weights(val rows: List<WeighIn>, val average: Double?) : ReplyBlock

    data class Text(val text: String) : ReplyBlock

    /** Como mucho una pregunta, siempre al final (regla 12). */
    data class Question(val text: String) : ReplyBlock
}

data class AssistantReply(val blocks: List<ReplyBlock>) {
    fun toMarkdown(): String = blocks.joinToString("\n\n") { it.toMarkdown() }
}

fun dayLabel(day: LocalDate): String = day.dayOfWeek.spanishName()

private fun row(vararg cells: String) = cells.joinToString(" | ", "| ", " |")

private fun ReplyBlock.toMarkdown(): String = when (this) {
    is ReplyBlock.Title -> "**$text**"
    is ReplyBlock.Notes -> lines.joinToString("\n")
    is ReplyBlock.Foods -> buildString {
        appendLine(row("", *rows.map { "${it.name} (${it.amount})" }.toTypedArray()))
        appendLine(row(*Array(rows.size + 1) { "---" }))
        appendLine(row("Kcal", *rows.map { formatKcal(it.macros.kcal) }.toTypedArray()))
        appendLine(row("Proteína", *rows.map { formatGrams(it.macros.protein) }.toTypedArray()))
        appendLine(row("Carbos", *rows.map { formatGrams(it.macros.carbs) }.toTypedArray()))
        append(row("Grasas", *rows.map { formatGrams(it.macros.fat) }.toTypedArray()))
    }
    is ReplyBlock.MealTotal -> buildString {
        appendLine("**${meal.label}:**")
        appendLine()
        appendLine(row("Kcal", "Proteína", "Carbos", "Grasas"))
        appendLine(row("---", "---", "---", "---"))
        append(macroCells(macros, estimated))
    }
    is ReplyBlock.DayTotal -> buildString {
        val state = if (final) "FINAL" else "parcial"
        appendLine("**Total día (${dayLabel(day)}, $state):**")
        appendLine()
        appendLine(row("", "Kcal", "Proteína", "Carbos", "Grasas"))
        appendLine(row("---", "---", "---", "---", "---"))
        rows.forEach { r ->
            appendLine(
                if (r.macros == null) row(r.meal.label, "-", "-", "-", "-")
                else macroCells(r.macros, false, r.meal.label)
            )
        }
        append(macroCells(total, estimated, "**Total**"))
    }
    is ReplyBlock.Change -> buildString {
        appendLine(row("", "Antes", "Ahora"))
        appendLine(row("---", "---", "---"))
        append(rows.joinToString("\n") { (label, before, after) -> row(label, before, after) })
        conclusion?.let { append("\n\n$it") }
    }
    is ReplyBlock.Balance -> buildString {
        val headers = mutableListOf("Día", "Gasto reloj", "Comido", "Déficit")
        if (showTarget) headers += listOf("Objetivo", "Diferencia")
        appendLine(row(*headers.toTypedArray()))
        appendLine(row(*Array(headers.size) { "---" }))
        days.forEach { d ->
            val cells = mutableListOf(
                dayLabel(d.day).replaceFirstChar { it.uppercase() },
                d.expenditure?.let { formatNumber(it, 0) } ?: "-",
                approx(formatNumber(d.intake, 0), d.estimated),
                d.deficit?.let { approx(formatNumber(it, 0), d.estimated) } ?: "-",
            )
            if (showTarget) {
                cells += d.target?.let { formatNumber(it, 0) } ?: "-"
                cells += d.vsTarget?.let { formatSigned(it) } ?: "-"
            }
            appendLine(row(*cells.toTypedArray()))
        }
        val total = mutableListOf("**Acumulado**", "", "", "**~${formatNumber(period.accumulatedDeficit, 0)}**")
        if (showTarget) total += listOf("", period.accumulatedVsTarget?.let { "**${formatSigned(it)}**" } ?: "-")
        append(row(*total.toTypedArray()))
    }
    is ReplyBlock.Weights -> buildString {
        appendLine(row("Día", "Peso"))
        appendLine(row("---", "---"))
        rows.forEach { appendLine(row(dayLabel(it.day).replaceFirstChar { c -> c.uppercase() }, "${formatNumber(it.kg, 1)} kg")) }
        append(row("**Media**", average?.let { "**${formatNumber(it, 2)} kg**" } ?: "-"))
    }
    is ReplyBlock.Text -> text
    is ReplyBlock.Question -> text
}

private fun macroCells(m: Macros, estimated: Boolean, label: String? = null): String {
    val cells = listOfNotNull(
        label,
        approx(formatKcal(m.kcal), estimated),
        formatGrams(m.protein),
        formatGrams(m.carbs),
        formatGrams(m.fat),
    )
    return row(*cells.toTypedArray())
}
