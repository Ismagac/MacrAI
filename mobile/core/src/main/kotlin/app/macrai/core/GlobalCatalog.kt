package app.macrai.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

// Catálogo global de MacrAI en Supabase (`alimentos_global`): productos de supermercado
// importados cada semana (nombre, EAN, formato, foto) cruzados con Open Food Facts, más las
// etiquetas que aportan los usuarios. Se lee sin cuenta, con la clave anónima.

class GlobalCatalog(private val client: SupabaseClient) : FoodDatabase {

    override suspend fun search(query: String, limit: Int): List<FoodProfile> {
        val result = client.rpc(
            "buscar_alimentos_global",
            buildJson {
                put("p_query", query)
                put("p_limit", limit)
            },
        ) as? JsonArray ?: return emptyList()
        return result.mapNotNull { parse(it.jsonObject) }
    }

    override suspend fun byBarcode(code: String): FoodProfile? {
        if (!code.all { it.isDigit() }) return null
        return client.select("alimentos_global", "select=*&codigo_barras=eq.$code&limit=1")
            .firstOrNull()?.let { parse(it.jsonObject) }
    }

    companion object {
        /** Sin tabla nutricional no sirve para registrar: se deja pasar a la siguiente base. */
        fun parse(row: JsonObject): FoodProfile? {
            if (row.bool("con_nutricion") == false) return null
            val name = row.str("nombre") ?: return null
            val market = row.str("supermercado")
            return FoodProfile(
                id = "global:${row.str("id")}",
                name = name,
                brand = row.str("marca"),
                per100 = Macros(
                    row.num("kcal_100g") ?: return null,
                    row.num("proteinas_100g") ?: 0.0,
                    row.num("carbohidratos_100g") ?: 0.0,
                    row.num("grasas_100g") ?: 0.0,
                ),
                basis = if (row.str("base") == "100ml") Basis.PER_100ML else Basis.PER_100G,
                source = ValueSource.WEB,
                packFormat = row.str("formato"),
                barcode = row.str("codigo_barras"),
                origin = "el catálogo de MacrAI" + (market?.let { " ($it)" } ?: ""),
            )
        }
    }
}

/** Primero el catálogo propio (rápido, en español, con Mercadona); después Open Food Facts. */
class ChainedFoodDatabase(private val sources: List<FoodDatabase>) : FoodDatabase {
    override suspend fun search(query: String, limit: Int): List<FoodProfile> {
        for (source in sources) {
            val found = runCatching { source.search(query, limit) }.getOrDefault(emptyList())
            if (found.isNotEmpty()) return found
        }
        return emptyList()
    }

    override suspend fun byBarcode(code: String): FoodProfile? =
        sources.firstNotNullOfOrNull { runCatching { it.byBarcode(code) }.getOrNull() }
}
