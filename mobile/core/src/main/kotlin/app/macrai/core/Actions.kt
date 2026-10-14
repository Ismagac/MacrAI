package app.macrai.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

// Lo único que el modelo produce: qué quiso decir el usuario (§3), en JSON.
// Las claves van en español para que el modelo pequeño del dispositivo las acierte;
// las cuentas las hace siempre el motor.

@Serializable
data class ParsedMessage(
    val acciones: List<Action> = emptyList(),
    /** Palabras mal transcritas por la voz que el modelo ha reinterpretado. */
    val voz: List<Mishearing> = emptyList(),
)

@Serializable
data class Mishearing(val oido: String, val entendido: String)

@Serializable
data class Per100(
    val kcal: Double? = null,
    val p: Double? = null,
    val c: Double? = null,
    val g: Double? = null,
) {
    fun toMacros(): Macros? =
        if (p == null || c == null || g == null) null
        else Macros(kcal ?: kcalFromMacros(Macros(0.0, p, c, g)), p, c, g)
}

@Serializable
data class LabelReading(
    val nombre: String,
    val marca: String? = null,
    @SerialName("por_100") val per100: Per100,
    /** "100g" o "100ml" */
    val base: String = "100g",
    /** "tal_cual", "preparado" o "escurrido" */
    val columna: String = "tal_cual",
    @SerialName("peso_unidad_g") val unitWeightG: Double? = null,
    val formato: String? = null,
)

@Serializable
data class ItemSpec(
    val alimento: String,
    /** Las palabras exactas del usuario para este alimento: de aquí salen los alias aprendidos. */
    val dicho: String? = null,
    /** Marca si la dice ("Hacendado", "HSN"): activa la búsqueda en la base de productos. */
    val marca: String? = null,
    val cantidad: Double? = null,
    /** "g", "ml" o "ud". Sin unidad son gramos. */
    val unidad: String = "g",
    /** El peso dicho incluye hueso o piel. Solo si el usuario lo dice. */
    @SerialName("con_hueso") val withPit: Boolean = false,
    /** Lo que se dejó en el plato (huesos, piel), en gramos. */
    @SerialName("dejado_g") val leftoverG: Double? = null,
    /** "Para comer entre dos": divide el total. */
    @SerialName("compartido_entre") val sharedBetween: Int? = null,
    /** "Laura se ha comido dos": unidades del paquete que no cuentan. */
    @SerialName("otros_comieron_ud") val othersAteUnits: Int? = null,
    /** Kcal dadas por el usuario: son fijas (§5.1, paso 3). */
    @SerialName("kcal_total") val kcalTotal: Double? = null,
    @SerialName("kcal_100") val kcalPer100: Double? = null,
    /** Etiqueta leída de la foto de este mismo mensaje. Manda siempre. */
    val etiqueta: LabelReading? = null,
    /** Estimación del modelo por 100 g, solo si el alimento no está en el catálogo. */
    @SerialName("estimacion_100") val estimatePer100: Per100? = null,
    /** El texto promete una foto que no ha llegado. */
    val provisional: Boolean = false,
)

@Serializable
sealed class Action {
    @Serializable @SerialName("anadir")
    data class Add(
        val items: List<ItemSpec>,
        val comida: Meal? = null,
        /** "hoy" (día de registro abierto) o "ayer" (cena de anoche). */
        val dia: String = "hoy",
    ) : Action()

    /** Cifra global sin desglose: solo kcal (§2.8). */
    @Serializable @SerialName("anadir_kcal")
    data class AddKcalOnly(val descripcion: String, val kcal: Double, val comida: Meal? = null, val dia: String = "hoy") : Action()

    @Serializable @SerialName("corregir_cantidad")
    data class CorrectQuantity(val objetivo: String? = null, val cantidad: Double, val unidad: String = "g") : Action()

    /** "Esos 200 gramos ya eran sin el hueso". */
    @Serializable @SerialName("corregir_estado")
    data class CorrectEdible(val objetivo: String? = null) : Action()

    @Serializable @SerialName("corregir_producto")
    data class CorrectProduct(
        val alimento: String,
        @SerialName("kcal_100") val kcalPer100: Double? = null,
        @SerialName("kcal_unidad") val kcalPerUnit: Double? = null,
        val etiqueta: LabelReading? = null,
    ) : Action()

    /** "Le he dado cuatro cucharadas": prorratea las entradas que formaban el plato. */
    @Serializable @SerialName("parcial")
    data class Partial(val objetivos: List<String>, val fraccion: Double) : Action()

    @Serializable @SerialName("mover")
    data class Move(val objetivo: String? = null, val comida: Meal) : Action()

    @Serializable @SerialName("borrar")
    data class Delete(val objetivo: String? = null) : Action()

    /** Etiquetas sin cantidad: se guardan y se pregunta cuánto (§2.4). */
    @Serializable @SerialName("guardar_etiqueta")
    data class SaveLabel(val etiqueta: LabelReading) : Action()

    @Serializable @SerialName("consultar_catalogo")
    data class CatalogQuery(val alimento: String) : Action()

    /** "Cuando diga «el batido» me refiero al queso fresco batido". */
    @Serializable @SerialName("alias")
    data class Alias(val alimento: String, val alias: String) : Action()

    /** Sí o no a la pregunta pendiente (p. ej. confirmar un alias aprendido). */
    @Serializable @SerialName("responder")
    data class Answer(val si: Boolean) : Action()

    @Serializable @SerialName("peso")
    data class Weight(val kg: Double) : Action()

    /** Captura del reloj o dato de Health Connect. La fecha es la de la captura. */
    @Serializable @SerialName("gasto")
    data class Burn(val kcal: Double, val fecha: String? = null, val pasos: Int? = null) : Action()

    @Serializable @SerialName("nuevo_dia")
    data object NewDay : Action()

    @Serializable @SerialName("cerrar_dia")
    data object CloseDay : Action()

    /** "¿Está bien planteado?", "¿vamos bien?": razonamiento con números, va a la nube. */
    @Serializable @SerialName("analisis")
    data class Analysis(val pregunta: String) : Action()

    @Serializable @SerialName("charla")
    data class Chat(val respuesta: String) : Action()
}

val ActionJson = Json {
    classDiscriminator = "tipo"
    ignoreUnknownKeys = true
    isLenient = true
    coerceInputValues = true
    explicitNulls = false
}

/** El modelo a veces envuelve el JSON en texto o en ```json; se extrae el primer objeto. */
fun parseModelOutput(raw: String): ParsedMessage? {
    val start = raw.indexOf('{')
    val end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    return runCatching { ActionJson.decodeFromString(ParsedMessage.serializer(), raw.substring(start, end + 1)) }
        .getOrNull()
}
