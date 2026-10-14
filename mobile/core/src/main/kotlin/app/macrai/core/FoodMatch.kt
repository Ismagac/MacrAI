package app.macrai.core

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

// Emparejado tolerante entre lo que dice el usuario (a menudo dictado y con erratas:
// "jam", "cottage magri", "leche deslatada") y su catálogo personal (§2.2, §5).

private val STOPWORDS = setOf(
    "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "o", "con", "sin",
    "al", "a", "para", "por", "en", "mi", "mis", "me", "he", "ha", "comido", "tomado", "anade",
    "pon", "ponle", "ponme", "agrega", "suma", "apunta", "registra", "quiero", "gramos", "gramo",
    "unidad", "unidades", "kcal", "esos", "esas", "eso", "esa", "otro", "otra",
)

private val ACCENTS = mapOf(
    'á' to 'a', 'à' to 'a', 'ä' to 'a', 'é' to 'e', 'è' to 'e', 'ë' to 'e', 'í' to 'i', 'ï' to 'i',
    'ó' to 'o', 'ò' to 'o', 'ö' to 'o', 'ú' to 'u', 'ü' to 'u', 'ñ' to 'n', 'ç' to 'c',
)

fun normalizeText(text: String): String =
    text.lowercase()
        .map { ACCENTS[it] ?: it }
        .joinToString("")
        .replace(Regex("[^a-z0-9\\s]"), " ")
        .replace(Regex("\\s+"), " ")
        .trim()

private fun tokenize(text: String): List<String> =
    normalizeText(text).split(' ').filter { it.length >= 3 && it !in STOPWORDS }

private fun withinEditDistance(a: String, b: String, maxEdits: Int): Boolean {
    if (abs(a.length - b.length) > maxEdits) return false
    if (a == b) return true
    var prev = IntArray(b.length + 1) { it }
    for (i in 1..a.length) {
        val curr = IntArray(b.length + 1)
        curr[0] = i
        var rowMin = i
        for (j in 1..b.length) {
            val cost = if (a[i - 1] == b[j - 1]) 0 else 1
            curr[j] = min(min(prev[j] + 1, curr[j - 1] + 1), prev[j - 1] + cost)
            rowMin = min(rowMin, curr[j])
        }
        if (rowMin > maxEdits) return false
        prev = curr
    }
    return prev[b.length] <= maxEdits
}

private fun tokensMatch(a: String, b: String): Boolean {
    if (a == b) return true
    // Plurales, derivados y palabras cortadas por la voz: "jam" → "jamon", "saboyard" → "saboyardo"
    if (min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a))) return true
    val tolerance = if (max(a.length, b.length) >= 7) 2 else 1
    return withinEditDistance(a, b, tolerance)
}

/** 0..1: cuánto encaja la frase del usuario con un nombre del catálogo. */
fun matchScore(userText: String, foodName: String): Double {
    val query = tokenize(userText)
    val name = tokenize(foodName)
    if (query.isEmpty() || name.isEmpty()) return 0.0

    val nameHits = name.count { n -> query.any { tokensMatch(n, it) } }
    if (nameHits == 0) return 0.0
    // Hace falta un término con entidad propia para que lo genérico no arrastre cualquier cosa.
    val distinctive = name.any { n -> n.length >= 3 && query.any { tokensMatch(n, it) } }
    if (!distinctive) return 0.0

    val queryHits = query.count { q -> name.any { tokensMatch(it, q) } }
    return max(nameHits.toDouble() / name.size, queryHits.toDouble() / query.size)
}

const val MIN_MATCH_SCORE = 0.5

fun FoodProfile.bestScore(userText: String): Double =
    (listOf(name, displayName) + aliases).maxOf { matchScore(userText, it) }
