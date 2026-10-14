package app.macrai.core

import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Modelo de dominio del registro. Sigue docs/asistente/comportamiento-chat-macros.md:
// cinco comidas, catálogo con fuente de cada valor y entradas que recuerdan sus supuestos.

@Serializable
enum class Meal(val label: String) {
    @SerialName("desayuno") DESAYUNO("Desayuno"),
    @SerialName("media_manana") MEDIA_MANANA("Media mañana"),
    @SerialName("comida") COMIDA("Comida"),
    @SerialName("merienda") MERIENDA("Merienda"),
    // Lo que se come después de cenar (postres, picoteo nocturno) también va aquí.
    @SerialName("cena") CENA("Cena"),
}

@Serializable
data class Macros(
    val kcal: Double = 0.0,
    val protein: Double = 0.0,
    val carbs: Double = 0.0,
    val fat: Double = 0.0,
) {
    operator fun plus(other: Macros) =
        Macros(kcal + other.kcal, protein + other.protein, carbs + other.carbs, fat + other.fat)

    operator fun times(factor: Double) =
        Macros(kcal * factor, protein * factor, carbs * factor, fat * factor)

    companion object {
        val ZERO = Macros()
    }
}

fun Iterable<Macros>.sum(): Macros = fold(Macros.ZERO) { acc, m -> acc + m }

/** De dónde sale un valor del catálogo. El orden es la prioridad de la cascada (§5.1). */
@Serializable
enum class ValueSource(val code: String, val label: String) {
    @SerialName("etiqueta") LABEL("E", "etiqueta"),
    @SerialName("usuario") USER("U", "dato tuyo"),
    @SerialName("web") WEB("Web", "web"),
    @SerialName("estimacion") ESTIMATE("Est", "estimación"),
}

@Serializable
enum class Basis(val unit: String) {
    @SerialName("100g") PER_100G("g"),
    @SerialName("100ml") PER_100ML("ml"),
}

/** Cabecera de la columna de la etiqueta: cambia qué significa la cantidad (§6.3). */
@Serializable
enum class LabelColumn {
    @SerialName("tal_cual") AS_SOLD,
    @SerialName("preparado") PREPARED,
    @SerialName("escurrido") DRAINED,
}

@Serializable
data class FoodProfile(
    val id: String,
    val name: String,
    val brand: String? = null,
    val per100: Macros,
    val basis: Basis = Basis.PER_100G,
    val source: ValueSource,
    /** Solo las kcal son del usuario o la etiqueta; P/C/G repartidos por tipo de alimento. */
    val macrosEstimated: Boolean = false,
    val column: LabelColumn = LabelColumn.AS_SOLD,
    /** Peso comestible de una unidad (mandarina pelada 120 g, lata de atún 56 g escurridos). */
    val unitWeightG: Double? = null,
    /** Para productos que solo se conocen por unidad (helado de 238 kcal la unidad). */
    val perUnit: Macros? = null,
    val packFormat: String? = null,
    /** Formas en que el usuario lo llama: "el batido", "la de Mercadona". */
    val aliases: List<String> = emptyList(),
    /** EAN del envase: el mismo producto por foto o por búsqueda es la misma entrada. */
    val barcode: String? = null,
    /** Base de la que salió, para decirlo ("Open Food Facts", "el catálogo de MacrAI (Mercadona)"). No se sincroniza. */
    val origin: String? = null,
) {
    val displayName: String get() = if (brand.isNullOrBlank()) name else "$name $brand"
}

@Serializable
data class LogEntry(
    val id: String,
    /** Día de registro, que no cambia a medianoche (§2.11). */
    val day: LocalDate,
    val meal: Meal,
    val name: String,
    val grams: Double,
    val macros: Macros,
    val foodId: String? = null,
    val source: ValueSource = ValueSource.ESTIMATE,
    val assumptions: List<String> = emptyList(),
    /** Registrado sin la etiqueta prometida; se sustituye al llegar (§2.4). */
    val provisional: Boolean = false,
    /** Cifra global sin desglose ("una cena de ~1.000 kcal"): no inventar macros (§2.8). */
    val kcalOnly: Boolean = false,
    /** Peso dicho antes de restar hueso o sobras; permite deshacerlo con "ya era sin hueso". */
    val statedGrams: Double? = null,
    /** Unidades dichas ("2 huevos"); para productos que solo se conocen por unidad. */
    val units: Double? = null,
    val loggedAt: LocalDateTime,
) {
    val isEstimate: Boolean get() = source == ValueSource.ESTIMATE || provisional || kcalOnly
}

@Serializable
data class WeighIn(val day: LocalDate, val kg: Double)

@Serializable
enum class ExpenditureSource {
    @SerialName("health_connect") HEALTH_CONNECT,
    @SerialName("captura") SCREENSHOT,
    @SerialName("manual") MANUAL,
}

@Serializable
data class Expenditure(
    val day: LocalDate,
    val totalKcal: Double,
    val steps: Int? = null,
    val source: ExpenditureSource,
)

@Serializable
data class UserContext(
    val weightKg: Double? = null,
    val heightCm: Double? = null,
    val age: Int? = null,
    /** Déficit diario objetivo; null si el usuario lo ha relajado (§10.2). */
    val dailyDeficitTarget: Double? = 500.0,
    val proteinPerKg: Double = 1.5,
    val activeInjury: String? = null,
) {
    /** Mínimo de proteína: 1,5 g/kg (§15). Con 92 kg salen ~140 g. */
    val proteinMinimum: Double? get() = weightKg?.let { roundTo(it * proteinPerKg, 0) }
}
