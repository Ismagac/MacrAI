package app.macrai.core

import kotlinx.datetime.LocalDate
import kotlinx.datetime.toJavaLocalDateTime
import kotlinx.datetime.toKotlinLocalDateTime
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import java.time.OffsetDateTime
import java.time.ZoneId

// Sincronización del registro con Supabase, registro a registro y sin conexión obligatoria.
//
// El móvil es la fuente de verdad mientras no hay red. En cada sincronización:
//   1. baja lo que cambió en el servidor desde la última vez (y los borrados);
//   2. lo mezcla: si un registro también cambió en el móvil, gana el del móvil;
//   3. sube lo que cambió en el móvil (y sus borrados).
// "Cambió" se decide comparando el contenido con el de la última sincronización, así que
// ninguna edición (chat o pantalla) tiene que marcar nada.
//
// Usa las tablas que ya lee la web (consumos, alimentos_usuario, profiles), así que el
// historial de la web aparece en la app y lo de la app en la web.

@Serializable
data class SyncMeta(
    /** "tabla:clave" → huella del contenido tal como quedó en la última sincronización. */
    val hashes: Map<String, Int> = emptyMap(),
    /** Mayor `updated_at` visto en el servidor (texto ISO tal cual lo devuelve). */
    val cursor: String? = null,
    /** Cuenta a la que pertenecen los datos de este móvil. */
    val userId: String? = null,
    /** Códigos de barras de etiquetas ya aportadas al catálogo global. */
    val contributed: Set<String> = emptySet(),
    val lastSyncAt: String? = null,
)

data class SyncReport(val pulled: Int, val pushed: Int, val deleted: Int, val contributed: Int)

class SyncException(message: String) : Exception(message)

private const val PAGE = 1000
private const val CHUNK = 100
/** Margen hacia atrás del cursor: cubre transacciones que confirmaron tarde. La mezcla es idempotente. */
private const val CURSOR_OVERLAP_S = 5L

internal object T {
    const val ENTRIES = "consumos"
    const val FOODS = "alimentos_usuario"
    const val WEIGHTS = "pesajes"
    const val BURNS = "gasto_diario"
    const val CLOSED = "dias_cerrados"
    const val PROFILE = "profiles"
    const val TOMBSTONES = "sync_borrados"
}

class SyncEngine(
    private val client: SupabaseClient,
    private val zone: ZoneId = ZoneId.systemDefault(),
    private val now: () -> OffsetDateTime = { OffsetDateTime.now() },
) {
    private val rows = SyncRows(zone)

    suspend fun sync(store: MacroStore): SyncReport {
        val session = client.session ?: throw SyncException("No has iniciado sesión.")
        val uid = session.userId
        val owner = store.state().sync.userId
        if (owner != null && owner != uid) {
            throw SyncException("Los datos de este móvil son de otra cuenta. Bórralos en Ajustes o entra con esa cuenta.")
        }

        // Datos de versiones anteriores con ids secuenciales: a UUID antes de nada.
        store.update { it.withUuidIds() }

        // 1. Bajar
        val start = store.state()
        val firstSync = start.sync.cursor == null
        val since = start.sync.cursor?.let { OffsetDateTime.parse(it).minusSeconds(CURSOR_OVERLAP_S).toString() }
        val remote = pull(uid, since)

        // 2. Mezclar sobre el estado más reciente (el usuario puede haber seguido escribiendo)
        val merged = store.update { current -> merge(current, remote, uid, firstSync) }

        // 3. Subir
        val local = rows.records(merged, uid)
        val changed = local.filter { (key, row) -> merged.sync.hashes[key] != row.hash() }
        val deleted = merged.sync.hashes.keys - local.keys
        push(uid, changed, deleted)
        val contributed = contribute(merged)

        store.update { current ->
            val currentRows = rows.records(current, uid)
            val hashes = current.sync.hashes.toMutableMap()
            // Solo se da por subido lo que no ha vuelto a cambiar mientras tanto.
            changed.forEach { (key, row) -> if (currentRows[key]?.hash() == row.hash()) hashes[key] = row.hash() }
            deleted.forEach { key -> if (key !in currentRows) hashes.remove(key) }
            current.copy(
                sync = current.sync.copy(
                    hashes = hashes,
                    contributed = current.sync.contributed + contributed,
                    lastSyncAt = now().toString(),
                ),
            )
        }
        return SyncReport(remote.count, changed.size, deleted.size, contributed.size)
    }

    // ─── Bajar ───────────────────────────────────────────────────────────────

    internal class Remote(
        val records: Map<String, JsonObject>,
        val tombstones: Set<String>,
        val cursor: String?,
    ) {
        val count: Int get() = records.size + tombstones.size
    }

    private suspend fun pull(uid: String, since: String?): Remote {
        val records = mutableMapOf<String, JsonObject>()
        var cursor: OffsetDateTime? = null
        fun see(stamp: String?) {
            val seen = stamp?.let { OffsetDateTime.parse(it) } ?: return
            val max = cursor
            if (max == null || seen.isAfter(max)) cursor = seen
        }
        val after = since?.let { "&updated_at=gt.${SupabaseClient.encode(it)}" } ?: ""

        for (table in listOf(T.ENTRIES, T.FOODS, T.WEIGHTS, T.BURNS, T.CLOSED)) {
            pages(table, "user_id=eq.$uid$after") { row ->
                records[rows.keyOf(table, row)] = row
                see(row.str("updated_at"))
            }
        }
        pages(T.PROFILE, "id=eq.$uid$after") { row ->
            records[rows.keyOf(T.PROFILE, row)] = row
            see(row.str("updated_at"))
        }

        val tombstones = mutableSetOf<String>()
        val deletedAfter = since?.let { "&borrado_at=gt.${SupabaseClient.encode(it)}" } ?: ""
        pages(T.TOMBSTONES, "user_id=eq.$uid$deletedAfter", order = "borrado_at") { row ->
            tombstones += "${row.str("tabla")}:${row.str("clave")}"
            see(row.str("borrado_at"))
        }
        return Remote(records, tombstones, cursor?.toString())
    }

    private suspend fun pages(table: String, filter: String, order: String = "updated_at", each: (JsonObject) -> Unit) {
        var offset = 0
        while (true) {
            val page = client.select(table, "select=*&$filter&order=$order.asc&limit=$PAGE&offset=$offset")
            page.forEach { each(it.jsonObject) }
            if (page.size < PAGE) return
            offset += PAGE
        }
    }

    // ─── Mezclar ─────────────────────────────────────────────────────────────

    private fun merge(current: StoreState, remote: Remote, uid: String, firstSync: Boolean): StoreState {
        val local = rows.records(current, uid)
        val hashes = current.sync.hashes.toMutableMap()
        // Cambiado en el móvil desde la última sincronización, o borrado en el móvil.
        fun dirty(key: String): Boolean = local[key]?.let { it.hash() != hashes[key] } ?: (key in hashes)

        var state = current
        for ((key, row) in remote.records) {
            val firstProfile = firstSync && key.startsWith("${T.PROFILE}:")
            if (dirty(key) && !firstProfile) continue
            state = rows.apply(state, key, row, keepLocalProfile = firstSync)
            // El primer perfil mezcla lo de la cuenta con lo del móvil: se sube después.
            if (!firstProfile) rows.records(state, uid)[key]?.let { hashes[key] = it.hash() }
        }
        for (key in remote.tombstones) {
            if (dirty(key)) continue
            state = rows.remove(state, key)
            hashes.remove(key)
        }

        val cursor = listOfNotNull(current.sync.cursor, remote.cursor).maxByOrNull { OffsetDateTime.parse(it) }
        return state.copy(sync = state.sync.copy(hashes = hashes, cursor = cursor, userId = uid))
    }

    // ─── Subir ───────────────────────────────────────────────────────────────

    private suspend fun push(uid: String, changed: Map<String, JsonObject>, deleted: Set<String>) {
        changed.entries.groupBy { it.key.substringBefore(':') }.forEach { (table, list) ->
            list.map { it.value }.chunked(CHUNK).forEach { chunk ->
                client.upsert(table, chunk, onConflict = rows.conflictKey(table))
            }
        }
        if (deleted.isEmpty()) return
        deleted.groupBy { it.substringBefore(':') }.forEach { (table, keys) ->
            keys.map { it.substringAfter(':') }.chunked(CHUNK).forEach { chunk ->
                val column = if (table == T.ENTRIES || table == T.FOODS) "id" else "fecha"
                client.delete(table, "user_id=eq.$uid&$column=in.(${chunk.joinToString(",")})")
            }
        }
        // Los borrados quedan apuntados para que los otros móviles también los quiten.
        val tombstones = deleted.map { key ->
            buildJson {
                put("user_id", uid)
                put("tabla", key.substringBefore(':'))
                put("clave", key.substringAfter(':'))
            }
        }
        tombstones.chunked(CHUNK).forEach { client.upsert(T.TOMBSTONES, it, onConflict = "user_id,tabla,clave") }
    }

    /**
     * Las etiquetas fotografiadas con código de barras se aportan al catálogo global: así los
     * productos que Open Food Facts no tiene se completan entre todos los usuarios.
     */
    private suspend fun contribute(state: StoreState): Set<String> {
        val pending = state.catalog.filter { it.source == ValueSource.LABEL && it.barcode != null && it.barcode !in state.sync.contributed }
        val done = mutableSetOf<String>()
        for (food in pending) {
            val ok = runCatching {
                client.rpc(
                    "aportar_etiqueta",
                    buildJson {
                        put("p_codigo_barras", food.barcode)
                        put("p_nombre", food.name)
                        put("p_marca", food.brand)
                        put("p_kcal", food.per100.kcal)
                        put("p_proteinas", food.per100.protein)
                        put("p_carbohidratos", food.per100.carbs)
                        put("p_grasas", food.per100.fat)
                        put("p_base", if (food.basis == Basis.PER_100ML) "100ml" else "100g")
                    },
                )
            }.isSuccess
            if (ok) done += food.barcode!!
        }
        return done
    }
}

private fun JsonObject.hash(): Int = toString().hashCode()

internal fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull
internal fun JsonObject.num(key: String): Double? = (this[key] as? JsonPrimitive)?.let { it.doubleOrNull ?: it.contentOrNull?.toDoubleOrNull() }
internal fun JsonObject.bool(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull

private val UUID_RE = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
fun isUuid(id: String?): Boolean = id != null && UUID_RE.matches(id)

/** Conversión entre el estado del móvil y las filas de Supabase. */
internal class SyncRows(private val zone: ZoneId) {

    fun conflictKey(table: String): String? = when (table) {
        T.WEIGHTS, T.BURNS, T.CLOSED -> "user_id,fecha"
        else -> null
    }

    fun keyOf(table: String, row: JsonObject): String = when (table) {
        T.WEIGHTS, T.BURNS, T.CLOSED -> "$table:${row.str("fecha")}"
        T.PROFILE -> "$table:me"
        else -> "$table:${row.str("id")}"
    }

    /** Todo lo que se sincroniza, con su fila tal como se sube. */
    fun records(state: StoreState, uid: String): Map<String, JsonObject> = buildMap {
        state.entries.filter { isUuid(it.id) }.forEach { put("${T.ENTRIES}:${it.id}", entryRow(it, uid, state)) }
        state.catalog.filter { isUuid(it.id) }.forEach { put("${T.FOODS}:${it.id}", foodRow(it, uid)) }
        state.weighIns.forEach { put("${T.WEIGHTS}:${it.day}", weighInRow(it, uid)) }
        state.expenditures.forEach { put("${T.BURNS}:${it.day}", burnRow(it, uid)) }
        state.closedDays.forEach { put("${T.CLOSED}:$it", buildJson { put("user_id", uid); put("fecha", it.toString()) }) }
        put("${T.PROFILE}:me", profileRow(state, uid))
    }

    fun apply(state: StoreState, key: String, row: JsonObject, keepLocalProfile: Boolean): StoreState {
        val table = key.substringBefore(':')
        val id = key.substringAfter(':')
        return when (table) {
            T.ENTRIES -> parseEntry(row)?.let { e -> state.copy(entries = state.entries.filterNot { it.id == id } + e) } ?: state
            T.FOODS -> parseFood(row)?.let { f -> state.copy(catalog = state.catalog.filterNot { it.id == id } + f) } ?: state
            T.WEIGHTS -> row.num("peso_kg")?.let { kg ->
                val day = LocalDate.parse(id)
                state.copy(weighIns = state.weighIns.filterNot { it.day == day } + WeighIn(day, kg))
            } ?: state
            T.BURNS -> row.num("kcal_total")?.let { kcal ->
                val day = LocalDate.parse(id)
                val source = when (row.str("fuente")) {
                    "health_connect" -> ExpenditureSource.HEALTH_CONNECT
                    "captura" -> ExpenditureSource.SCREENSHOT
                    else -> ExpenditureSource.MANUAL
                }
                state.copy(expenditures = state.expenditures.filterNot { it.day == day } + Expenditure(day, kcal, row.num("pasos")?.toInt(), source))
            } ?: state
            T.CLOSED -> state.copy(closedDays = state.closedDays + LocalDate.parse(id))
            T.PROFILE -> applyProfile(state, row, keepLocalProfile)
            else -> state
        }
    }

    fun remove(state: StoreState, key: String): StoreState {
        val id = key.substringAfter(':')
        return when (key.substringBefore(':')) {
            T.ENTRIES -> state.copy(entries = state.entries.filterNot { it.id == id })
            T.FOODS -> state.copy(catalog = state.catalog.filterNot { it.id == id })
            T.WEIGHTS -> state.copy(weighIns = state.weighIns.filterNot { it.day.toString() == id })
            T.BURNS -> state.copy(expenditures = state.expenditures.filterNot { it.day.toString() == id })
            T.CLOSED -> state.copy(closedDays = state.closedDays.filterNot { it.toString() == id }.toSet())
            else -> state
        }
    }

    // ─── Consumos ────────────────────────────────────────────────────────────

    private fun entryRow(e: LogEntry, uid: String, state: StoreState): JsonObject {
        val ref = e.foodId?.takeIf { id -> isUuid(id) && state.catalog.any { it.id == id } }
        return buildJson {
            put("id", e.id)
            put("user_id", uid)
            put("fecha", e.day.toString())
            put("tipo_comida", mealToDb(e.meal))
            put("nombre_alimento", e.name)
            put("cantidad_gr", roundTo(e.grams, 1))
            put("kcal", roundTo(e.macros.kcal, 2))
            put("proteinas", roundTo(e.macros.protein, 2))
            put("carbohidratos", roundTo(e.macros.carbs, 2))
            put("grasas", roundTo(e.macros.fat, 2))
            put("alimento_ref_id", ref)
            put("alimento_source", if (ref != null) "usuario" else "manual")
            put("fuente", sourceToDb(e.source))
            put("supuestos", JsonArray(e.assumptions.map { JsonPrimitive(it) }))
            put("provisional", e.provisional)
            put("solo_kcal", e.kcalOnly)
            put("cantidad_dicha_gr", e.statedGrams?.let { roundTo(it, 1) })
            put("unidades", e.units?.let { roundTo(it, 2) })
            put("hora_insercion", e.loggedAt.toJavaLocalDateTime().atZone(zone).toOffsetDateTime().toString())
        }
    }

    private fun parseEntry(row: JsonObject): LogEntry? {
        val id = row.str("id") ?: return null
        val day = row.str("fecha")?.let { LocalDate.parse(it.take(10)) } ?: return null
        val loggedAt = row.str("hora_insercion")?.let {
            runCatching { OffsetDateTime.parse(it).atZoneSameInstant(zone).toLocalDateTime().toKotlinLocalDateTime() }.getOrNull()
        } ?: kotlinx.datetime.LocalDateTime(day, kotlinx.datetime.LocalTime(12, 0))
        val kcalOnly = row.bool("solo_kcal") ?: false
        return LogEntry(
            id = id,
            day = day,
            meal = mealFromDb(row.str("tipo_comida"), loggedAt),
            name = row.str("nombre_alimento") ?: "Alimento",
            grams = row.num("cantidad_gr") ?: 0.0,
            macros = Macros(row.num("kcal") ?: 0.0, row.num("proteinas") ?: 0.0, row.num("carbohidratos") ?: 0.0, row.num("grasas") ?: 0.0),
            foodId = row.str("alimento_ref_id"),
            source = sourceFromDb(row.str("fuente"))
                ?: if (row.str("alimento_source") == "openfoodfacts" || row.str("alimento_source") == "global") ValueSource.WEB else ValueSource.USER,
            assumptions = (row["supuestos"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty(),
            provisional = row.bool("provisional") ?: false,
            kcalOnly = kcalOnly,
            statedGrams = row.num("cantidad_dicha_gr"),
            units = row.num("unidades"),
            loggedAt = loggedAt,
        )
    }

    // ─── Catálogo personal ───────────────────────────────────────────────────

    private fun foodRow(f: FoodProfile, uid: String): JsonObject = buildJson {
        put("id", f.id)
        put("user_id", uid)
        put("nombre", f.name)
        put("marca", f.brand)
        put("kcal_100g", roundTo(f.per100.kcal, 2))
        put("proteinas_100g", roundTo(f.per100.protein, 2))
        put("carbohidratos_100g", roundTo(f.per100.carbs, 2))
        put("grasas_100g", roundTo(f.per100.fat, 2))
        put("fuente", sourceToDb(f.source))
        put("macros_estimados", f.macrosEstimated)
        put("base", if (f.basis == Basis.PER_100ML) "100ml" else "100g")
        put("columna", when (f.column) { LabelColumn.PREPARED -> "preparado"; LabelColumn.DRAINED -> "escurrido"; LabelColumn.AS_SOLD -> "tal_cual" })
        put("peso_unidad_g", f.unitWeightG?.let { roundTo(it, 1) })
        put("formato_envase", f.packFormat)
        put("codigo_barras", f.barcode)
        put("alias", JsonArray(f.aliases.map { JsonPrimitive(it) }))
        put("kcal_unidad", f.perUnit?.let { roundTo(it.kcal, 2) })
        put("proteinas_unidad", f.perUnit?.let { roundTo(it.protein, 2) })
        put("carbohidratos_unidad", f.perUnit?.let { roundTo(it.carbs, 2) })
        put("grasas_unidad", f.perUnit?.let { roundTo(it.fat, 2) })
    }

    private fun parseFood(row: JsonObject): FoodProfile? {
        val id = row.str("id") ?: return null
        // Alimentos creados en la web "por unidad" usan las columnas *_per_unit.
        val perUnit = row.num("kcal_unidad")?.let {
            Macros(it, row.num("proteinas_unidad") ?: 0.0, row.num("carbohidratos_unidad") ?: 0.0, row.num("grasas_unidad") ?: 0.0)
        } ?: row.takeIf { it.str("macros_basis") == "per_unit" }?.num("kcal_per_unit")?.let {
            Macros(it, row.num("proteinas_per_unit") ?: 0.0, row.num("carbohidratos_per_unit") ?: 0.0, row.num("grasas_per_unit") ?: 0.0)
        }
        return FoodProfile(
            id = id,
            name = row.str("nombre") ?: return null,
            brand = row.str("marca"),
            per100 = Macros(row.num("kcal_100g") ?: 0.0, row.num("proteinas_100g") ?: 0.0, row.num("carbohidratos_100g") ?: 0.0, row.num("grasas_100g") ?: 0.0),
            basis = if (row.str("base") == "100ml") Basis.PER_100ML else Basis.PER_100G,
            source = sourceFromDb(row.str("fuente")) ?: ValueSource.USER,
            macrosEstimated = row.bool("macros_estimados") ?: false,
            column = when (row.str("columna")) { "preparado" -> LabelColumn.PREPARED; "escurrido" -> LabelColumn.DRAINED; else -> LabelColumn.AS_SOLD },
            unitWeightG = row.num("peso_unidad_g"),
            perUnit = perUnit,
            packFormat = row.str("formato_envase"),
            aliases = (row["alias"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty(),
            barcode = row.str("codigo_barras"),
        )
    }

    // ─── Peso, gasto, perfil ─────────────────────────────────────────────────

    private fun weighInRow(w: WeighIn, uid: String) = buildJson {
        put("user_id", uid)
        put("fecha", w.day.toString())
        put("peso_kg", roundTo(w.kg, 2))
    }

    private fun burnRow(x: Expenditure, uid: String) = buildJson {
        put("user_id", uid)
        put("fecha", x.day.toString())
        put("kcal_total", roundTo(x.totalKcal, 1))
        put("pasos", x.steps)
        put("fuente", when (x.source) { ExpenditureSource.HEALTH_CONNECT -> "health_connect"; ExpenditureSource.SCREENSHOT -> "captura"; ExpenditureSource.MANUAL -> "manual" })
    }

    private fun profileRow(state: StoreState, uid: String) = buildJson {
        put("id", uid)
        put("peso_kg", state.user.weightKg?.let { roundTo(it, 2) })
        put("altura_cm", state.user.heightCm)
        put("edad", state.user.age)
        put("deficit_objetivo_kcal", state.user.dailyDeficitTarget)
        put("proteina_g_por_kg", state.user.proteinPerKg)
        put("lesion_activa", state.user.activeInjury)
        put("dia_abierto", state.openDay?.toString())
    }

    private fun applyProfile(state: StoreState, row: JsonObject, keepLocal: Boolean): StoreState {
        // En la primera sincronización de un móvil, lo que ya hay en la cuenta manda, pero un
        // dato que solo tiene el móvil no se pierde.
        fun <T> pick(remote: T?, local: T?): T? = if (keepLocal) remote ?: local else remote
        val user = state.user
        val openDay = row.str("dia_abierto")?.let { LocalDate.parse(it) }
        return state.copy(
            user = user.copy(
                weightKg = pick(row.num("peso_kg"), user.weightKg),
                heightCm = pick(row.num("altura_cm"), user.heightCm),
                age = pick(row.num("edad")?.toInt(), user.age),
                dailyDeficitTarget = if (row.containsKey("deficit_objetivo_kcal")) row.num("deficit_objetivo_kcal") else user.dailyDeficitTarget,
                proteinPerKg = row.num("proteina_g_por_kg") ?: user.proteinPerKg,
                activeInjury = pick(row.str("lesion_activa"), user.activeInjury),
            ),
            openDay = listOfNotNull(openDay, state.openDay).maxOrNull(),
        )
    }

    private fun mealToDb(m: Meal) = when (m) {
        Meal.DESAYUNO -> "desayuno"
        Meal.MEDIA_MANANA -> "almuerzo"
        Meal.COMIDA -> "comida"
        Meal.MERIENDA -> "merienda"
        Meal.CENA -> "cena"
    }

    /** La web también usaba "snack" (después de cenar) y "otro". */
    private fun mealFromDb(value: String?, at: kotlinx.datetime.LocalDateTime) = when (value) {
        "desayuno" -> Meal.DESAYUNO
        "almuerzo" -> Meal.MEDIA_MANANA
        "comida" -> Meal.COMIDA
        "merienda" -> Meal.MERIENDA
        "cena", "snack" -> Meal.CENA
        else -> mealForClock(at)
    }

    private fun sourceToDb(s: ValueSource) = when (s) {
        ValueSource.LABEL -> "etiqueta"
        ValueSource.USER -> "usuario"
        ValueSource.WEB -> "web"
        ValueSource.ESTIMATE -> "estimacion"
    }

    private fun sourceFromDb(s: String?) = when (s) {
        "etiqueta" -> ValueSource.LABEL
        "usuario" -> ValueSource.USER
        "web" -> ValueSource.WEB
        "estimacion" -> ValueSource.ESTIMATE
        else -> null
    }
}

/** Datos de versiones anteriores con ids secuenciales ("e1", "f3"): pasan a UUID antes de subir. */
fun StoreState.withUuidIds(): StoreState {
    val foodIds = catalog.filterNot { isUuid(it.id) }.associate { it.id to newId() }
    if (foodIds.isEmpty() && entries.all { isUuid(it.id) }) return this
    return copy(
        catalog = catalog.map { f -> foodIds[f.id]?.let { f.copy(id = it) } ?: f },
        entries = entries.map { e ->
            e.copy(
                id = if (isUuid(e.id)) e.id else newId(),
                foodId = e.foodId?.let { foodIds[it] ?: it },
            )
        },
    )
}
