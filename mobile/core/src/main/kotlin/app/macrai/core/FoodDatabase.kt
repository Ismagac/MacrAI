package app.macrai.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.net.URLEncoder

// Base de productos de marca: paso 4 de la cascada (§5.1), después del catálogo personal y
// de las kcal que dé el usuario, antes de estimar.
//
// Se usa Open Food Facts: abierta (licencia ODbL, hay que citarla), internacional y con
// buena cobertura de Mercadona/Hacendado, Carrefour, Lidl o Dia. Mercadona no tiene API
// pública; sus endpoints internos cambian sin aviso y no sirven para una app publicada.

interface FoodDatabase {
    suspend fun search(query: String, limit: Int = 5): List<FoodProfile>
    suspend fun byBarcode(code: String): FoodProfile?
}

/** GET que devuelve el cuerpo o null. La app pone la red; los tests, respuestas fijas. */
fun interface HttpGet {
    suspend fun get(url: String): String?
}

class OpenFoodFacts(private val http: HttpGet) : FoodDatabase {
    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun search(query: String, limit: Int): List<FoodProfile> {
        val q = URLEncoder.encode(query, "UTF-8")
        // Primero el catálogo español; si no hay nada, el mundial.
        for (host in listOf("es", "world")) {
            val body = http.get(
                "https://$host.openfoodfacts.org/cgi/search.pl?search_terms=$q&search_simple=1&action=process" +
                    "&json=1&page_size=${limit * 3}&fields=$FIELDS",
            ) ?: continue
            val products = runCatching { json.parseToJsonElement(body).jsonObject["products"]?.jsonArray }.getOrNull()
                ?: continue
            val found = products.mapNotNull { parseProduct(it.jsonObject) }
                .sortedByDescending { it.bestScore(query) }
                .take(limit)
            if (found.isNotEmpty()) return found
        }
        return emptyList()
    }

    override suspend fun byBarcode(code: String): FoodProfile? {
        val body = http.get("https://world.openfoodfacts.org/api/v2/product/$code.json?fields=$FIELDS") ?: return null
        val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull() ?: return null
        return root["product"]?.let { parseProduct(it.jsonObject) }
    }

    companion object {
        private const val FIELDS = "code,product_name,product_name_es,brands,nutriments,quantity"
        private const val KJ_PER_KCAL = 4.184

        fun parseProduct(p: JsonObject): FoodProfile? {
            val code = p.string("code") ?: return null
            val name = p.string("product_name_es")?.takeIf { it.isNotBlank() }
                ?: p.string("product_name")?.takeIf { it.isNotBlank() }
                ?: return null
            val n = p["nutriments"]?.jsonObject ?: return null
            val protein = n.number("proteins_100g") ?: return null
            val carbs = n.number("carbohydrates_100g") ?: return null
            val fat = n.number("fat_100g") ?: return null
            val kcal = n.number("energy-kcal_100g")
                ?: n.number("energy_100g")?.let { it / KJ_PER_KCAL }
                ?: kcalFromMacros(Macros(0.0, protein, carbs, fat))
            val quantity = p.string("quantity")
            val liquid = quantity?.trim()?.lowercase()?.let { it.endsWith("ml") || it.endsWith(" l") || it.endsWith("cl") } == true
            return FoodProfile(
                id = "off:$code",
                name = name.trim(),
                brand = p.string("brands")?.split(',')?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() },
                per100 = Macros(roundTo(kcal, 1), protein, carbs, fat),
                basis = if (liquid) Basis.PER_100ML else Basis.PER_100G,
                source = ValueSource.WEB,
                packFormat = quantity,
                barcode = code,
            )
        }

        private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

        // Open Food Facts mezcla números y textos ("12.5") según quién subió el producto.
        private fun JsonObject.number(key: String): Double? =
            (this[key] as? JsonPrimitive)?.let { it.doubleOrNull ?: it.contentOrNull?.replace(',', '.')?.toDoubleOrNull() }
    }
}
