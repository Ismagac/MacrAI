package app.macrai.android.data

import app.macrai.core.HttpGet
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

// Open Food Facts pide un User-Agent propio que identifique la app y un contacto.
private const val USER_AGENT = "MacrAI/0.1 (Android; https://github.com/Ismagac/MacrAI)"
private const val TIMEOUT_MS = 8000

/** GET sencillo: devuelve el cuerpo con 200 y null con cualquier otra cosa (sin red, 404, 429…). */
class AndroidHttp : HttpGet {
    override suspend fun get(url: String): String? = withContext(Dispatchers.IO) {
        runCatching {
            val connection = URL(url).openConnection() as HttpURLConnection
            try {
                connection.connectTimeout = TIMEOUT_MS
                connection.readTimeout = TIMEOUT_MS
                connection.setRequestProperty("User-Agent", USER_AGENT)
                connection.setRequestProperty("Accept", "application/json")
                if (connection.responseCode == HttpURLConnection.HTTP_OK) {
                    connection.inputStream.bufferedReader().use { it.readText() }
                } else {
                    null
                }
            } finally {
                connection.disconnect()
            }
        }.getOrNull()
    }
}
