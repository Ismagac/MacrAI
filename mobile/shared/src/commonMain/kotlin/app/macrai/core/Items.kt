package app.macrai.core

import kotlin.math.abs
import kotlin.math.roundToInt

// Resolución de cada alimento del mensaje: qué perfil se usa (cascada del §5.1) y qué
// cantidad comestible sale (§2.9, §2.10, §7). Cada decisión deja su supuesto escrito.

/** Hueso medio por pieza (§7.1). El usuario puede corregirlo con un mensaje. */
private val PIT_WEIGHTS_G = mapOf(
    "melocoton" to 15.0,
    "nectarina" to 12.0,
    "albaricoque" to 5.0,
    "ciruela" to 5.0,
    "mango" to 40.0,
    "aguacate" to 35.0,
)

/** Sin peso unitario conocido se asume esto y se dice. */
const val DEFAULT_UNIT_WEIGHT_G = 100.0

sealed interface ItemResult {
    data class Resolved(
        val name: String,
        val grams: Double,
        val macros: Macros,
        val source: ValueSource,
        val foodId: String?,
        val assumptions: List<String>,
        val provisional: Boolean,
        /** Peso que dijo el usuario antes de restar hueso o sobras, para "ya era sin hueso". */
        val statedGrams: Double?,
        val units: Double?,
    ) : ItemResult

    data class Missing(val name: String, val question: String) : ItemResult
}

data class ProfileChoice(val profile: FoodProfile, val isNew: Boolean, val notes: List<String>)

fun foodKindOf(name: String): FoodKind {
    val n = normalizeText(name)
    return when {
        listOf("leche", "zumo", "batido", "kefir").any { it in n } -> FoodKind.DAIRY_DRINK
        PIT_WEIGHTS_G.keys.any { it in n } || listOf("mandarina", "manzana", "platano", "fresa", "sandia", "melon").any { it in n } -> FoodKind.FRUIT
        else -> FoodKind.OTHER
    }
}

/** Resumen de etiqueta en una línea, en el orden en que la lee el usuario (§6.4). */
fun labelSummary(profile: FoodProfile): String {
    val m = profile.per100
    return "Por 100 ${profile.basis.unit}: ${formatKcal(m.kcal)} kcal, ${formatGrams(m.fat)} grasas, " +
        "${formatGrams(m.carbs)} carbos, ${formatGrams(m.protein)} proteína."
}

/** Valida la etiqueta y la convierte en perfil. Null si faltan macros para usarla. */
fun labelToProfile(label: LabelReading, id: String): Pair<FoodProfile, List<String>>? {
    val p = label.per100.p ?: return null
    val c = label.per100.c ?: return null
    val g = label.per100.g ?: return null
    val notes = mutableListOf<String>()

    var per100 = Macros(label.per100.kcal ?: 0.0, p, c, g)
    if (label.per100.kcal == null) {
        per100 = per100.withKcalFromMacros()
        notes += "La energía no se ve en la foto; la saco de los macros (${formatKcal(per100.kcal)} kcal/100)."
    } else {
        val check = checkLabel(per100)
        if (!check.consistent) {
            notes += "La etiqueta no cuadra: dice ${formatKcal(check.declaredKcal)} kcal y los macros dan " +
                "${formatKcal(check.computedKcal)}. Puede haber una fila desplazada; revisa la foto."
        }
    }

    val profile = FoodProfile(
        id = id,
        name = label.nombre,
        brand = label.marca,
        per100 = per100,
        basis = if (label.base.contains("ml")) Basis.PER_100ML else Basis.PER_100G,
        source = ValueSource.LABEL,
        column = when (label.columna) {
            "preparado" -> LabelColumn.PREPARED
            "escurrido" -> LabelColumn.DRAINED
            else -> LabelColumn.AS_SOLD
        },
        unitWeightG = label.unitWeightG,
        packFormat = label.formato,
    )
    return profile to notes
}

private const val SAME_PRODUCT_SCORE = 0.75

/**
 * Productos distintos con el mismo nombre son productos distintos (regla 11): si la
 * etiqueta no coincide con lo que hay en el catálogo, se guarda aparte y nunca se sobrescribe.
 */
fun mergeLabelIntoCatalog(label: FoodProfile, catalog: List<FoodProfile>, userName: String? = null): ProfileChoice {
    // También cuenta cómo lo llamó el usuario: dijo "ketchup light" y la foto es de otro ketchup.
    val similar = catalog
        .map { it to maxOf(it.bestScore(label.displayName), userName?.let { n -> it.bestScore(n) } ?: 0.0) }
        .filter { it.second >= SAME_PRODUCT_SCORE }
        .maxByOrNull { it.second }
        ?.first
        ?: return ProfileChoice(label, isNew = true, notes = emptyList())

    val sameValues = similar.per100.kcal > 0 &&
        abs(similar.per100.kcal - label.per100.kcal) / similar.per100.kcal <= LABEL_TOLERANCE
    val sameBrand = similar.brand == null || label.brand == null ||
        normalizeText(similar.brand) == normalizeText(label.brand)

    return if (sameValues && sameBrand) {
        ProfileChoice(label.copy(id = similar.id, aliases = similar.aliases, unitWeightG = label.unitWeightG ?: similar.unitWeightG), isNew = false, notes = emptyList())
    } else {
        ProfileChoice(
            label,
            isNew = true,
            notes = listOf(
                "No es el mismo producto que «${similar.displayName}» del catálogo " +
                    "(${formatKcal(similar.per100.kcal)} kcal/100 ${similar.basis.unit}): lo guardo aparte.",
            ),
        )
    }
}

/**
 * Sin marca y con varios parecidos en el catálogo, se usa el último que consumió (§5.2).
 * Una coincidencia exacta de nombre o alias gana siempre.
 */
fun findInCatalog(text: String, catalog: List<FoodProfile>, history: List<LogEntry>): FoodProfile? {
    val normalized = normalizeText(text)
    catalog.firstOrNull { f -> (listOf(f.name, f.displayName) + f.aliases).any { normalizeText(it) == normalized } }
        ?.let { return it }

    val scored = catalog.map { it to it.bestScore(text) }.filter { it.second >= MIN_MATCH_SCORE }
    if (scored.isEmpty()) return null
    val top = scored.maxOf { it.second }
    val tied = scored.filter { top - it.second < 0.01 }.map { it.first }
    if (tied.size == 1) return tied.first()

    val lastUse = history.sortedByDescending { it.loggedAt }.firstOrNull { e -> tied.any { it.id == e.foodId } }
    return tied.firstOrNull { it.id == lastUse?.foodId } ?: tied.first()
}

fun chooseProfile(
    spec: ItemSpec,
    catalog: List<FoodProfile>,
    history: List<LogEntry>,
    newId: () -> String,
): ProfileChoice? {
    spec.etiqueta?.let { label ->
        val (profile, notes) = labelToProfile(label, newId()) ?: return@let
        val merged = mergeLabelIntoCatalog(profile, catalog, spec.alimento)
        return merged.copy(notes = notes + merged.notes)
    }

    findInCatalog(spec.alimento, catalog, history)?.let { return ProfileChoice(it, isNew = false, notes = emptyList()) }

    val estimate = spec.estimatePer100?.toMacros()
    if (spec.kcalPer100 != null) {
        // Las kcal del usuario son fijas; los macros salen de la forma de la estimación.
        val shape = estimate ?: return null
        val factor = if (shape.kcal > 0) spec.kcalPer100 / shape.kcal else 0.0
        val per100 = Macros(spec.kcalPer100, shape.protein * factor, shape.carbs * factor, shape.fat * factor)
        return ProfileChoice(
            FoodProfile(newId(), spec.alimento, per100 = per100, source = ValueSource.USER, macrosEstimated = true),
            isNew = true,
            notes = emptyList(),
        )
    }
    if (estimate != null) {
        return ProfileChoice(FoodProfile(newId(), spec.alimento, per100 = estimate, source = ValueSource.ESTIMATE), isNew = true, notes = emptyList())
    }
    return null
}

private fun pitWeightFor(name: String): Double? {
    val n = normalizeText(name)
    return PIT_WEIGHTS_G.entries.firstOrNull { it.key in n }?.value
}

/** [isNewProfile]: la estimación es de ahora y hay que decirla; las del catálogo ya se dijeron. */
fun resolveItem(spec: ItemSpec, profile: FoodProfile, isNewProfile: Boolean = false): ItemResult {
    val notes = mutableListOf<String>()
    val isUnits = spec.unidad == "ud"

    var units: Double? = null
    var grams: Double
    var macros: Macros

    if (isUnits) {
        val n = spec.cantidad ?: 1.0
        units = n
        val known = profile.macrosForUnits(n)
        if (known != null) {
            macros = known
            grams = profile.unitWeightG?.let { it * n } ?: 0.0
            profile.unitWeightG?.let { notes += "Cuento ${formatNumber(n)} × ${formatNumber(it)} g." }
        } else {
            grams = DEFAULT_UNIT_WEIGHT_G * n
            macros = profile.macrosForGrams(grams)
            notes += "No sé cuánto pesa una unidad de ${profile.name}: he supuesto ${formatNumber(DEFAULT_UNIT_WEIGHT_G)} g."
        }
    } else {
        grams = spec.cantidad
            ?: return ItemResult.Missing(profile.name, "¿Cuántos gramos de ${profile.name.lowercase()}?")
        if (profile.basis == Basis.PER_100ML && spec.unidad == "g") notes += "He contado los gramos como ml (1 g ≈ 1 ml)."
        macros = profile.macrosForGrams(grams)
    }

    val stated = grams
    if (spec.withPit) {
        val pit = pitWeightFor(profile.name)
        if (pit != null) {
            val pieces = units ?: 1.0
            grams -= pit * pieces
            notes += "Resto el hueso (~${formatNumber(pit * pieces)} g): cuento ${formatNumber(grams)} g comestibles."
        }
    }
    spec.leftoverG?.let {
        grams -= it
        notes += "Descuento los ${formatNumber(it)} g que dejaste: ${formatNumber(grams)} g comestibles."
    }
    spec.othersAteUnits?.let { others ->
        val pieceG = profile.unitWeightG
        if (pieceG != null && pieceG > 0) {
            val pieces = (grams / pieceG).roundToInt().coerceAtLeast(others + 1)
            val mine = pieces - others
            grams = grams * mine / pieces
            notes += "Supongo ~$pieces piezas y cuento $mine (~${formatNumber(grams, 0)} g). Si recuerdas cuántas eran, lo ajusto."
        }
    }
    spec.sharedBetween?.takeIf { it > 1 }?.let { n ->
        grams /= n
        notes += "Plato para $n: cuento ${formatNumber(grams)} g de ${formatNumber(grams * n)}."
    }
    if (grams != stated && grams > 0) macros = profile.macrosForGrams(grams)

    var source = profile.source
    spec.kcalTotal?.let { kcal ->
        // Kcal del usuario para lo que se ha comido: fijas, el resto escalado.
        val factor = if (macros.kcal > 0) kcal / macros.kcal else 0.0
        macros = if (factor > 0) macros * factor else Macros(kcal = kcal)
        source = ValueSource.USER
    }

    when {
        spec.provisional -> notes += "Provisional con ${profile.source.label}; lo actualizo cuando me pases la etiqueta."
        source == ValueSource.ESTIMATE && isNewProfile -> notes += "${profile.name}: estimado a ${formatKcal(profile.per100.kcal)} kcal/100 ${profile.basis.unit}."
    }

    return ItemResult.Resolved(
        name = profile.displayName,
        grams = grams,
        macros = macros,
        source = source,
        foodId = profile.id,
        assumptions = notes,
        provisional = spec.provisional,
        statedGrams = stated.takeIf { it != grams },
        units = units,
    )
}
