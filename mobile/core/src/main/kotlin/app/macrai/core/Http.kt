package app.macrai.core

// HTTP mínimo que el núcleo necesita (Open Food Facts y Supabase). La app pone la red real;
// los tests, un servidor falso en memoria.

data class HttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    val body: String? = null,
)

data class HttpResponse(val status: Int, val body: String) {
    val ok: Boolean get() = status in 200..299
}

fun interface Http {
    suspend fun send(request: HttpRequest): HttpResponse
}

/** GET que devuelve el cuerpo con 2xx y null con cualquier otra cosa o sin red. */
suspend fun Http.getOrNull(url: String, headers: Map<String, String> = emptyMap()): String? =
    runCatching { send(HttpRequest("GET", url, headers)) }.getOrNull()?.takeIf { it.ok }?.body
