package app.macrai.core

// Importa un catálogo escrito en Markdown, como docs/datos/catalogo-inicial.md: tablas
// "| Alimento | Kcal | P | C | G | Fuente |" por secciones y una tabla de alias
// "| "frase", "frase" | Entrada del catálogo |".
//
// Entiende la notación de ese documento: "~" aproximado, "<0,8" tope, "–" sin dato,
// "238/ud" o "46/envase" por unidad, y los paréntesis con peso por unidad ("(~11 g)",
// "lata 56 g"), estado ("escurrida") o base ("por 100 ml").

data class CatalogImport(val foods: List<FoodProfile>, val aliases: Map<String, List<String>>)

data class ImportResult(val state: StoreState, val added: Int, val skipped: Int, val aliases: Int)

private val UNIT_WEIGHT = Regex("""^(?:lata\s+)?~?(\d+(?:[.,]\d+)?)\s*(g|ml)(?:/ud)?$""")
private val CELL_NUMBER = Regex("""(\d+(?:[.,]\d+)?)""")

fun parseCatalogMarkdown(markdown: String): CatalogImport {
    val foods = mutableListOf<FoodProfile>()
    val aliasRows = mutableListOf<Pair<List<String>, String>>()
    var section = ""
    var inAliases = false

    for (raw in markdown.lines()) {
        val line = raw.trim()
        when {
            line.startsWith("## ") -> inAliases = line.contains("alias", ignoreCase = true)
            line.startsWith("### ") -> section = line.removePrefix("### ")
            line.startsWith("|") && !line.startsWith("|---") -> {
                val cells = line.trim('|').split('|').map { it.trim() }
                if (inAliases && cells.size >= 2 && cells[0].contains('"')) {
                    val phrases = Regex("\"([^\"]+)\"").findAll(cells[0]).map { it.groupValues[1] }.toList()
                    aliasRows += phrases to cells[1].substringBefore('(').trim()
                } else if (!inAliases && cells.size >= 6 && cells[0] != "Alimento") {
                    parseFoodRow(cells, section)?.let { foods += it }
                }
            }
        }
    }

    // Cada fila de alias va al alimento importado que mejor encaja con su nombre.
    val aliases = mutableMapOf<String, MutableList<String>>()
    for ((phrases, target) in aliasRows) {
        val food = foods.map { it to matchScore(target, it.name) }
            .filter { it.second >= MIN_MATCH_SCORE }
            .maxByOrNull { it.second }?.first ?: continue
        aliases.getOrPut(food.id) { mutableListOf() } += phrases
    }
    return CatalogImport(foods, aliases)
}

private fun parseFoodRow(cells: List<String>, section: String): FoodProfile? {
    val (rawName, kcalCell, pCell, cCell, gCell) = cells
    val sourceCell = cells[5]
    val kcal = number(kcalCell) ?: return null
    val perUnitValue = kcalCell.contains("/ud") || kcalCell.contains("/envase")

    var unitWeight: Double? = null
    var drained = false
    var perMl = section.contains("100 ml") || rawName.startsWith("Leche") ||
        rawName.contains("Zumo") || rawName.contains("Caldo")
    var pack: String? = null
    val keep = mutableListOf<String>()

    val paren = Regex("""\(([^)]*)\)""").find(rawName)
    paren?.groupValues?.get(1)?.split(',')?.map { it.trim() }?.forEach { token ->
        val lower = token.lowercase()
        val weight = UNIT_WEIGHT.find(lower)
        when {
            weight != null -> {
                unitWeight = weight.groupValues[1].replace(',', '.').toDouble()
                if (weight.groupValues[2] == "ml") perMl = true
            }
            lower.startsWith("escurrid") -> drained = true
            lower == "por 100 ml" -> perMl = true
            lower.startsWith("bolsa") || lower.startsWith("sobre") -> pack = token
            else -> keep += token
        }
    }
    val baseName = paren?.let { rawName.replace(it.value, "").trim() } ?: rawName
    val name = (if (keep.isEmpty()) baseName else "$baseName (${keep.joinToString(", ")})").replace("\"", "").trim()

    val p = number(pCell)
    val c = number(cCell)
    val g = number(gCell)
    val values = Macros(kcal, p ?: 0.0, c ?: 0.0, g ?: 0.0)
    val estimated = sourceCell.contains("(kcal)") || listOf(pCell, cCell, gCell).any { it.contains('~') || it.contains('–') } ||
        p == null || c == null || g == null

    val perUnit = if (perUnitValue) values else null
    val per100 = when {
        perUnit == null -> values
        unitWeight != null -> perUnit * (100.0 / unitWeight!!)
        // Sin peso conocido, el valor por unidad hace de referencia; se registra por unidades.
        else -> perUnit
    }

    return FoodProfile(
        id = newId(),
        name = name,
        per100 = per100,
        basis = if (perMl) Basis.PER_100ML else Basis.PER_100G,
        source = when {
            sourceCell.startsWith("E") -> ValueSource.LABEL
            sourceCell.startsWith("U") -> ValueSource.USER
            sourceCell.startsWith("Web") -> ValueSource.WEB
            else -> ValueSource.ESTIMATE
        },
        macrosEstimated = estimated,
        column = when {
            drained -> LabelColumn.DRAINED
            section.contains("preparado") -> LabelColumn.PREPARED
            else -> LabelColumn.AS_SOLD
        },
        unitWeightG = unitWeight,
        perUnit = perUnit,
        packFormat = pack,
    )
}

/** "~7,5" → 7.5; "<0,8" → 0.8 (el tope, como dice el documento); "–" → null. */
private fun number(cell: String): Double? =
    CELL_NUMBER.find(cell)?.groupValues?.get(1)?.replace(',', '.')?.toDoubleOrNull()

/**
 * Añade al catálogo lo que no exista ya con el mismo nombre (nunca sobrescribe valores) y
 * suma los alias, también a los alimentos que ya estaban.
 */
fun StoreState.importCatalog(import: CatalogImport): ImportResult {
    var state = this
    var added = 0
    var skipped = 0
    var aliasCount = 0
    for (food in import.foods) {
        val existing = state.catalog.firstOrNull { normalizeText(it.name) == normalizeText(food.name) }
        val targetId = if (existing == null) {
            state = state.copy(catalog = state.catalog + food)
            added++
            food.id
        } else {
            skipped++
            existing.id
        }
        import.aliases[food.id].orEmpty().forEach { alias ->
            val before = state.catalog.first { it.id == targetId }.aliases.size
            state = state.addAlias(targetId, alias)
            if (state.catalog.first { it.id == targetId }.aliases.size > before) aliasCount++
        }
    }
    return ImportResult(state, added, skipped, aliasCount)
}
