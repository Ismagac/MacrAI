package app.macrai.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.URLDecoder
import java.time.OffsetDateTime
import java.time.ZoneOffset

// Supabase en memoria para los tests: Auth por email y lo que la sincronización usa de
// PostgREST (filtros eq/gt/in, orden, paginación, upsert, borrado y dos RPC).

class FakeSupabase : Http {
    val tables = mutableMapOf<String, MutableList<JsonObject>>()
    val rpcCalls = mutableListOf<Pair<String, JsonObject>>()
    private val users = mutableMapOf<String, Pair<String, String>>() // email → (password, id)
    private var clock = OffsetDateTime.of(2026, 10, 14, 8, 0, 0, 0, ZoneOffset.UTC)
    private var tokenCounter = 0
    /** Fuerza un 401 en la próxima llamada REST para probar la renovación del token. */
    var expireNextToken = false
    /** La renovación de sesión falla, como con una cuenta cerrada en otro móvil. */
    var revokeRefresh = false

    private val primaryKeys = mapOf(
        "consumos" to listOf("id"),
        "alimentos_usuario" to listOf("id"),
        "profiles" to listOf("id"),
        "pesajes" to listOf("user_id", "fecha"),
        "gasto_diario" to listOf("user_id", "fecha"),
        "dias_cerrados" to listOf("user_id", "fecha"),
        "sync_borrados" to listOf("user_id", "tabla", "clave"),
        "alimentos_global" to listOf("id"),
    )

    fun addUser(email: String, password: String, id: String) {
        users[email] = password to id
        table("profiles") += JsonObject(mapOf("id" to JsonPrimitive(id), "updated_at" to JsonPrimitive(tick())))
    }

    fun table(name: String) = tables.getOrPut(name) { mutableListOf() }

    private fun tick(): String {
        clock = clock.plusSeconds(10)
        return clock.toString()
    }

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://fake.supabase.co").substringBefore('?')
        val query = request.url.substringAfter('?', "")
        return when {
            path.startsWith("/auth/v1/") -> auth(path.removePrefix("/auth/v1/"), query, request.body)
            path.startsWith("/rest/v1/") -> {
                val token = request.headers["Authorization"]?.removePrefix("Bearer ")
                if (expireNextToken && token?.startsWith("tok-") == true) {
                    expireNextToken = false
                    return HttpResponse(401, """{"message":"JWT expired"}""")
                }
                rest(request.method, path.removePrefix("/rest/v1/"), query, request.body)
            }
            else -> HttpResponse(404, "")
        }
    }

    private fun auth(path: String, query: String, body: String?): HttpResponse {
        val json = Json.parseToJsonElement(body ?: "{}").jsonObject
        fun session(id: String, email: String) = HttpResponse(
            200,
            """{"access_token":"tok-$id-${++tokenCounter}","refresh_token":"ref-$id","expires_in":3600,"user":{"id":"$id","email":"$email"}}""",
        )
        return when {
            path == "signup" -> {
                val email = json["email"]!!.jsonPrimitive.content
                val id = "00000000-0000-4000-8000-" + (users.size + 1).toString().padStart(12, '0')
                addUser(email, json["password"]!!.jsonPrimitive.content, id)
                session(id, email)
            }
            path == "token" && query == "grant_type=password" -> {
                val email = json["email"]!!.jsonPrimitive.content
                val user = users[email]
                if (user == null || user.first != json["password"]!!.jsonPrimitive.content) {
                    HttpResponse(400, """{"error_description":"Invalid login credentials"}""")
                } else {
                    session(user.second, email)
                }
            }
            path == "token" && query == "grant_type=refresh_token" && revokeRefresh ->
                HttpResponse(400, """{"error_description":"Invalid Refresh Token"}""")
            path == "token" && query == "grant_type=refresh_token" -> {
                val id = json["refresh_token"]!!.jsonPrimitive.content.removePrefix("ref-")
                session(id, users.entries.first { it.value.second == id }.key)
            }
            path == "logout" -> HttpResponse(204, "")
            else -> HttpResponse(404, "")
        }
    }

    private fun rest(method: String, path: String, query: String, body: String?): HttpResponse {
        val params = query.split('&').filter { it.isNotEmpty() }.map {
            it.substringBefore('=') to URLDecoder.decode(it.substringAfter('='), "UTF-8")
        }
        if (path.startsWith("rpc/")) return rpc(path.removePrefix("rpc/"), Json.parseToJsonElement(body ?: "{}").jsonObject)

        val rows = table(path)
        val filters = params.filterNot { it.first in setOf("select", "order", "limit", "offset", "on_conflict") }
        fun matches(row: JsonObject) = filters.all { (column, expr) ->
            val value = (row[column] as? JsonPrimitive)?.content
            when {
                expr.startsWith("eq.") -> value == expr.removePrefix("eq.")
                expr.startsWith("gt.") -> value != null && OffsetDateTime.parse(value).isAfter(OffsetDateTime.parse(expr.removePrefix("gt.")))
                expr.startsWith("in.(") -> value in expr.removePrefix("in.(").removeSuffix(")").split(',')
                else -> error("Filtro no soportado: $column=$expr")
            }
        }

        return when (method) {
            "GET" -> {
                val order = params.firstOrNull { it.first == "order" }?.second?.substringBefore('.')
                val offset = params.firstOrNull { it.first == "offset" }?.second?.toInt() ?: 0
                val limit = params.firstOrNull { it.first == "limit" }?.second?.toInt() ?: Int.MAX_VALUE
                val selected = rows.filter(::matches)
                    .let { list -> order?.let { o -> list.sortedBy { (it[o] as? JsonPrimitive)?.content } } ?: list }
                    .drop(offset).take(limit)
                HttpResponse(200, JsonArray(selected).toString())
            }
            "POST" -> {
                val keys = params.firstOrNull { it.first == "on_conflict" }?.second?.split(',') ?: primaryKeys.getValue(path)
                Json.parseToJsonElement(body!!).jsonArray.forEach { element ->
                    val incoming = element.jsonObject
                    val stamp = if (path == "sync_borrados") "borrado_at" else "updated_at"
                    val index = rows.indexOfFirst { existing -> keys.all { existing[it] == incoming[it] } }
                    val merged = JsonObject((if (index >= 0) rows[index] else emptyMap()) + incoming + (stamp to JsonPrimitive(tick())))
                    if (index >= 0) rows[index] = merged else rows += merged
                }
                HttpResponse(201, "")
            }
            "DELETE" -> {
                rows.removeAll(::matches)
                HttpResponse(204, "")
            }
            else -> HttpResponse(405, "")
        }
    }

    private fun rpc(name: String, args: JsonObject): HttpResponse {
        rpcCalls += name to args
        return when (name) {
            "buscar_alimentos_global" -> {
                val q = args["p_query"]!!.jsonPrimitive.content
                HttpResponse(200, JsonArray(table("alimentos_global").filter { it.bestNameScore(q) }).toString())
            }
            else -> HttpResponse(204, "")
        }
    }

    private fun JsonObject.bestNameScore(q: String) =
        matchScore(q, (this["nombre"] as JsonPrimitive).content) >= MIN_MATCH_SCORE
}

const val FAKE_URL = "https://fake.supabase.co"
