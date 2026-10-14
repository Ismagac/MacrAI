package app.macrai.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.net.URLEncoder

// Cliente mínimo de Supabase: Auth (email y contraseña) y PostgREST. Lo justo para la
// sincronización y el catálogo global; sin SDK, así se prueba en la JVM con un servidor falso.

data class SupabaseConfig(val url: String, val anonKey: String) {
    val base: String get() = url.trimEnd('/')
}

@Serializable
data class Session(
    val accessToken: String,
    val refreshToken: String,
    val userId: String,
    val email: String? = null,
    /** Segundos epoch en que caduca el access token. */
    val expiresAt: Long = 0,
)

/** Dónde guarda la app la sesión (preferencias privadas en Android, memoria en tests). */
interface SessionStore {
    fun load(): Session?
    fun save(session: Session?)
}

class InMemorySessionStore(private var session: Session? = null) : SessionStore {
    override fun load() = session
    override fun save(session: Session?) { this.session = session }
}

class SupabaseException(val status: Int, message: String) : Exception(message)

sealed interface SignUpResult {
    data class SignedIn(val session: Session) : SignUpResult
    /** El proyecto exige confirmar el email: hay que abrir el enlace y luego entrar. */
    data object ConfirmEmail : SignUpResult
}

internal val SupabaseJson = Json { ignoreUnknownKeys = true; explicitNulls = false }

class SupabaseClient(
    private val config: SupabaseConfig,
    private val http: Http,
    private val sessions: SessionStore,
    private val nowEpochSeconds: () -> Long = { System.currentTimeMillis() / 1000 },
) {
    val session: Session? get() = sessions.load()

    // ─── Auth ────────────────────────────────────────────────────────────────

    suspend fun signUp(email: String, password: String): SignUpResult {
        val body = authCall("signup", buildJson { put("email", email); put("password", password) })
        val parsed = parseSession(body)
        return if (parsed != null) {
            sessions.save(parsed)
            SignUpResult.SignedIn(parsed)
        } else {
            SignUpResult.ConfirmEmail
        }
    }

    suspend fun signIn(email: String, password: String): Session {
        val body = authCall("token?grant_type=password", buildJson { put("email", email); put("password", password) })
        val parsed = parseSession(body) ?: throw SupabaseException(500, "Respuesta de sesión inesperada")
        sessions.save(parsed)
        return parsed
    }

    suspend fun signOut() {
        val current = sessions.load() ?: return
        runCatching {
            http.send(HttpRequest("POST", "${config.base}/auth/v1/logout", authHeaders(current.accessToken)))
        }
        sessions.save(null)
    }

    /** Borra la cuenta y todos sus datos en el servidor (función `borrar_mi_cuenta`). */
    suspend fun deleteAccount() {
        rpc("borrar_mi_cuenta", JsonObject(emptyMap()))
        sessions.save(null)
    }

    private suspend fun refresh(current: Session): Session {
        val body = try {
            authCall("token?grant_type=refresh_token", buildJson { put("refresh_token", current.refreshToken) })
        } catch (e: SupabaseException) {
            // Sesión revocada o caducada del todo: hay que volver a entrar.
            if (e.status == 400 || e.status == 401) {
                sessions.save(null)
                throw SupabaseException(401, "La sesión ha caducado. Vuelve a entrar.")
            }
            throw e
        }
        val parsed = parseSession(body) ?: throw SupabaseException(401, "No se pudo renovar la sesión")
        sessions.save(parsed)
        return parsed
    }

    private suspend fun authCall(path: String, payload: JsonObject): String {
        val response = http.send(
            HttpRequest(
                "POST",
                "${config.base}/auth/v1/$path",
                mapOf("apikey" to config.anonKey, "Content-Type" to "application/json"),
                payload.toString(),
            ),
        )
        if (!response.ok) throw SupabaseException(response.status, authError(response.body))
        return response.body
    }

    private fun authError(body: String): String = runCatching {
        val o = SupabaseJson.parseToJsonElement(body).jsonObject
        listOf("msg", "error_description", "message", "error").firstNotNullOfOrNull { o[it]?.jsonPrimitive?.contentOrNull }
    }.getOrNull() ?: "Error de autenticación"

    private fun parseSession(body: String): Session? = runCatching {
        val o = SupabaseJson.parseToJsonElement(body).jsonObject
        val access = o["access_token"]?.jsonPrimitive?.contentOrNull ?: return null
        val user = o["user"]?.jsonObject ?: return null
        Session(
            accessToken = access,
            refreshToken = o["refresh_token"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            userId = user["id"]!!.jsonPrimitive.content,
            email = user["email"]?.jsonPrimitive?.contentOrNull,
            expiresAt = o["expires_at"]?.jsonPrimitive?.longOrNull
                ?: (nowEpochSeconds() + (o["expires_in"]?.jsonPrimitive?.longOrNull ?: 3600)),
        )
    }.getOrNull()

    // ─── PostgREST ───────────────────────────────────────────────────────────

    /** GET de una tabla con filtros PostgREST ya escritos (`updated_at=gt.…`). */
    suspend fun select(table: String, query: String): JsonArray {
        val body = rest("GET", "$table?$query", null)
        return SupabaseJson.parseToJsonElement(body) as JsonArray
    }

    /** Upsert por clave primaria (o por [onConflict]). Todas las filas deben tener las mismas columnas. */
    suspend fun upsert(table: String, rows: List<JsonObject>, onConflict: String? = null) {
        if (rows.isEmpty()) return
        val conflict = onConflict?.let { "?on_conflict=$it" } ?: ""
        rest("POST", "$table$conflict", JsonArray(rows).toString(), prefer = "resolution=merge-duplicates,return=minimal")
    }

    suspend fun delete(table: String, query: String) {
        rest("DELETE", "$table?$query", null, prefer = "return=minimal")
    }

    suspend fun rpc(function: String, args: JsonObject): JsonElement? {
        val body = rest("POST", "rpc/$function", args.toString())
        return if (body.isBlank()) null else SupabaseJson.parseToJsonElement(body)
    }

    private suspend fun rest(method: String, path: String, body: String?, prefer: String? = null): String {
        suspend fun call(token: String): HttpResponse {
            val headers = authHeaders(token) + buildMap {
                put("Content-Type", "application/json")
                prefer?.let { put("Prefer", it) }
            }
            return http.send(HttpRequest(method, "${config.base}/rest/v1/$path", headers, body))
        }

        // Sin sesión se usa la clave anónima: el catálogo global se lee sin cuenta.
        var current = sessions.load()
        if (current != null && current.expiresAt - nowEpochSeconds() < TOKEN_MARGIN_S) current = refresh(current)
        var response = call(current?.accessToken ?: config.anonKey)
        if (response.status == 401 && current != null) {
            current = refresh(current)
            response = call(current.accessToken)
        }
        if (!response.ok) throw SupabaseException(response.status, response.body.take(300))
        return response.body
    }

    private fun authHeaders(token: String) = mapOf("apikey" to config.anonKey, "Authorization" to "Bearer $token")

    companion object {
        /** Se renueva el token si caduca en menos de este margen. */
        const val TOKEN_MARGIN_S = 60L

        fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")
    }
}

internal inline fun buildJson(block: MutableMap<String, JsonElement>.() -> Unit): JsonObject =
    JsonObject(buildMap(block))

internal fun MutableMap<String, JsonElement>.put(key: String, value: String?) {
    put(key, kotlinx.serialization.json.JsonPrimitive(value))
}

internal fun MutableMap<String, JsonElement>.put(key: String, value: Number?) {
    put(key, kotlinx.serialization.json.JsonPrimitive(value))
}

internal fun MutableMap<String, JsonElement>.put(key: String, value: Boolean?) {
    put(key, kotlinx.serialization.json.JsonPrimitive(value))
}
