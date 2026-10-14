package app.macrai.core

// Dos prompts para dos modelos.
//
// - Extracción (Gemini Nano en el dispositivo, o la nube si no hay Nano): convierte el
//   mensaje en acciones JSON. Tiene que caber en la ventana pequeña del modelo local
//   (~4k tokens), así que solo lleva el esquema, ejemplos reales y los alimentos del
//   catálogo que se parecen a lo dicho, no el catálogo entero.
// - Razonamiento (nube): preguntas de análisis. Lleva el documento de comportamiento
//   completo como system prompt y los datos ya calculados por el motor.

const val MAX_CATALOG_CANDIDATES = 8

private val EXTRACTION_RULES = """
Eres el intérprete de un registro de comidas en español de España. Convierte el mensaje en JSON.
Devuelve SOLO un objeto {"acciones":[...],"voz":[...]} sin texto alrededor. No calcules totales.

Reglas:
- Sin unidad son gramos. "un/una/dos + alimento contable" es unidad "ud".
- Líquidos en ml. "comida" solo si el usuario la dice: desayuno, media_manana, comida, merienda, cena.
- El mensaje viene a menudo de voz con errores ("anillo"=añade, "jam"=jamón, "deslatada"=desnatada).
  Interpreta por el alimento del catálogo más parecido y anota en "voz" lo que reinterpretaste.
- Usa el nombre del catálogo cuando encaje. Si no está, añade "estimacion_100" con kcal,p,c,g.
- Si hay texto de etiqueta (OCR), rellena "etiqueta" con los valores por 100 g/ml. Manda sobre el catálogo.
- Si el usuario da kcal ("de 238 kcal", "20 calorías cada 100"), ponlas en kcal_total o kcal_100.
- Peso en ayunas → peso. Captura del reloj → gasto con la fecha de la captura.
- Preguntas de razonamiento ("¿está bien planteado?", "¿vamos bien?") → analisis.

Tipos: anadir{items,comida?,dia:"hoy"|"ayer"}, anadir_kcal{descripcion,kcal}, corregir_cantidad{objetivo?,cantidad,unidad},
corregir_estado{objetivo?}, corregir_producto{alimento,kcal_100?,kcal_unidad?,etiqueta?}, parcial{objetivos,fraccion},
mover{objetivo?,comida}, borrar{objetivo?}, guardar_etiqueta{etiqueta}, consultar_catalogo{alimento}, peso{kg},
gasto{kcal,fecha?,pasos?}, nuevo_dia, cerrar_dia, analisis{pregunta}, charla{respuesta}.
item: {alimento,cantidad?,unidad,con_hueso?,dejado_g?,compartido_entre?,otros_comieron_ud?,kcal_total?,kcal_100?,etiqueta?,estimacion_100?,provisional?}
""".trimIndent()

private val EXTRACTION_EXAMPLES = """
Ejemplos:
"Añade 150 de leche desnatada a la merienda" → {"acciones":[{"tipo":"anadir","comida":"merienda","items":[{"alimento":"leche desnatada","cantidad":150,"unidad":"ml"}]}]}
"Anillo de 35 de ketchup light" → {"acciones":[{"tipo":"anadir","items":[{"alimento":"ketchup light","cantidad":35}]}],"voz":[{"oido":"anillo","entendido":"añade"}]}
"Y añade dos huevos" → {"acciones":[{"tipo":"anadir","items":[{"alimento":"huevo","cantidad":2,"unidad":"ud"}]}]}
"un melocotón que entero y con hueso pesa 220" → {"acciones":[{"tipo":"anadir","items":[{"alimento":"melocotón","cantidad":220,"con_hueso":true}]}]}
"Al final han sido solo 175 gramos de sopa" → {"acciones":[{"tipo":"corregir_cantidad","objetivo":"sopa","cantidad":175}]}
"No, esos 200 gramos ya eran sin el hueso" → {"acciones":[{"tipo":"corregir_estado"}]}
"Le he dado cuatro cucharadas a la sopa de arroz" → {"acciones":[{"tipo":"parcial","objetivos":["caldo","arroz"],"fraccion":0.1}]}
"Un paquete de Pepero de fresa de 32 g, Laura se ha comido dos" → {"acciones":[{"tipo":"anadir","items":[{"alimento":"Pepero de fresa","cantidad":32,"otros_comieron_ud":2}]}]}
"Al final me tomé también el zumo en la cena de ayer" → {"acciones":[{"tipo":"anadir","comida":"cena","dia":"ayer","items":[{"alimento":"zumo","cantidad":1,"unidad":"ud"}]}]}
"igual fue una cena de 1000 calorías" → {"acciones":[{"tipo":"anadir_kcal","descripcion":"cena a ojo","kcal":1000,"comida":"cena"}]}
"Apunta 91,7 para el peso" → {"acciones":[{"tipo":"peso","kg":91.7}]}
"¿Tienes los macros de la sopa de cebolla que tomo?" → {"acciones":[{"tipo":"consultar_catalogo","alimento":"sopa de cebolla"}]}
""".trimIndent()

fun candidateFoods(catalog: List<FoodProfile>, text: String, limit: Int = MAX_CATALOG_CANDIDATES): List<FoodProfile> =
    catalog.map { it to it.bestScore(text) }
        .filter { it.second >= MIN_MATCH_SCORE }
        .sortedByDescending { it.second }
        .take(limit)
        .map { it.first }

fun buildExtractionPrompt(
    text: String,
    catalog: List<FoodProfile>,
    lastMeal: Meal?,
    ocrText: String? = null,
    pendingQuestion: String? = null,
): String = buildString {
    appendLine(EXTRACTION_RULES)
    appendLine()
    appendLine(EXTRACTION_EXAMPLES)
    appendLine()
    val candidates = candidateFoods(catalog, text)
    if (candidates.isNotEmpty()) {
        appendLine("Catálogo del usuario que se parece al mensaje:")
        candidates.forEach { f ->
            val unit = f.unitWeightG?.let { ", unidad ${formatNumber(it)} g" } ?: ""
            appendLine("- ${f.displayName}$unit")
        }
        appendLine()
    }
    lastMeal?.let { appendLine("Última comida registrada: ${it.label}.") }
    // Sin historial de chat, la pregunta pendiente es lo que da sentido a un "150" suelto.
    pendingQuestion?.let { appendLine("Pregunta pendiente al usuario: $it") }
    ocrText?.takeIf { it.isNotBlank() }?.let {
        appendLine("Texto de la etiqueta de la foto (OCR, puede venir desordenado):")
        appendLine(it.take(1500))
    }
    appendLine()
    append("Mensaje: ")
    append(text)
}

/** System prompt de la nube: el documento de comportamiento entero más los datos del motor. */
fun buildReasoningPrompt(behaviorDoc: String, facts: String): String =
    behaviorDoc + "\n\n---\n\n## Datos actuales (calculados por la app, son exactos)\n\n" + facts +
        "\n\nResponde a la pregunta con estos números. No recalcules lo que ya viene calculado."
