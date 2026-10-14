package app.macrai.core

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val MADRID = ZoneId.of("Europe/Madrid")
private const val UID = "11111111-1111-4111-8111-111111111111"

private class Device(server: FakeSupabase, state: StoreState = StoreState()) {
    val store = InMemoryMacroStore(state)
    val client = SupabaseClient(SupabaseConfig(FAKE_URL, "anon"), server, InMemorySessionStore())
    val sync = SyncEngine(client, MADRID)

    suspend fun signIn() = client.signIn("ana@example.com", "secreta1")
}

private fun food(id: String = newId(), name: String = "Queso fresco batido 0 %") =
    FoodProfile(id, name, per100 = Macros(46.0, 7.5, 4.0, 0.2), source = ValueSource.USER, aliases = listOf("el batido"))

private fun entry(foodId: String?, grams: Double = 150.0, id: String = newId()) =
    LogEntry(id, WED, Meal.MERIENDA, "Queso fresco batido 0 %", grams, Macros(69.0, 11.3, 6.0, 0.3), foodId = foodId, source = ValueSource.USER, loggedAt = at(WED, 18, 0))

class SyncTest {
    private fun server() = FakeSupabase().apply { addUser("ana@example.com", "secreta1", UID) }

    @Test fun secondPhoneGetsEverythingTheFirstOneLogged() = runTest {
        val server = server()
        val batido = food()
        val a = Device(
            server,
            StoreState(
                entries = listOf(entry(batido.id)),
                catalog = listOf(batido),
                weighIns = listOf(WeighIn(WED, 92.6)),
                expenditures = listOf(Expenditure(WED, 3038.0, 12000, ExpenditureSource.HEALTH_CONNECT)),
                closedDays = setOf(WED),
                user = UserContext(weightKg = 92.6, dailyDeficitTarget = null),
                openDay = WED,
            ),
        )
        a.signIn()
        val first = a.sync.sync(a.store)
        assertEquals(6, first.pushed) // consumo, alimento, peso, gasto, día cerrado y perfil

        val b = Device(server)
        b.signIn()
        b.sync.sync(b.store)
        val s = b.store.state()
        assertEquals(listOf(batido.id), s.catalog.map { it.id })
        assertEquals(listOf("el batido"), s.catalog.single().aliases)
        assertEquals(150.0, s.entries.single().grams)
        assertEquals(at(WED, 18, 0), s.entries.single().loggedAt)
        assertEquals(92.6, s.weighIns.single().kg)
        assertEquals(12000, s.expenditures.single().steps)
        assertEquals(setOf(WED), s.closedDays)
        assertEquals(92.6, s.user.weightKg)
        assertNull(s.user.dailyDeficitTarget)
        assertEquals(WED, s.openDay)

        // Sin cambios, la siguiente sincronización no sube nada.
        assertEquals(0, b.sync.sync(b.store).pushed)
    }

    @Test fun editsAndDeletionsTravelBetweenPhones() = runTest {
        val server = server()
        val batido = food()
        val keep = entry(batido.id)
        val drop = entry(batido.id, grams = 50.0)
        val a = Device(server, StoreState(entries = listOf(keep, drop), catalog = listOf(batido)))
        a.signIn(); a.sync.sync(a.store)
        val b = Device(server)
        b.signIn(); b.sync.sync(b.store)

        b.store.update { it.deleteEntry(drop.id).updateEntryGrams(keep.id, 200.0) }
        val report = b.sync.sync(b.store)
        assertEquals(1, report.deleted)
        assertTrue(server.table("sync_borrados").any { it["clave"]?.jsonPrimitive?.content == drop.id })

        a.sync.sync(a.store)
        val entries = a.store.state().entries
        assertEquals(listOf(keep.id), entries.map { it.id })
        assertEquals(200.0, entries.single().grams)
        assertEquals(92.0, roundTo(entries.single().macros.kcal, 0))
    }

    @Test fun webHistoryComesIntoTheAppWithItsMeals() = runTest {
        val server = server()
        server.table("consumos") += JsonObject(
            mapOf(
                "id" to JsonPrimitive("22222222-2222-4222-8222-222222222222"),
                "user_id" to JsonPrimitive(UID),
                "fecha" to JsonPrimitive("2026-10-06"),
                "tipo_comida" to JsonPrimitive("snack"),
                "nombre_alimento" to JsonPrimitive("Helado"),
                "cantidad_gr" to JsonPrimitive(70),
                "kcal" to JsonPrimitive(238),
                "proteinas" to JsonPrimitive(3.5),
                "carbohidratos" to JsonPrimitive(31),
                "grasas" to JsonPrimitive(9.5),
                "alimento_source" to JsonPrimitive("manual"),
                "hora_insercion" to JsonPrimitive("2026-10-06T21:40:00+00:00"),
                "updated_at" to JsonPrimitive("2026-10-06T21:40:00+00:00"),
            ),
        )
        val phone = Device(server)
        phone.signIn()
        phone.sync.sync(phone.store)
        val helado = phone.store.state().entries.single()
        assertEquals(Meal.CENA, helado.meal)
        assertEquals(238.0, helado.macros.kcal)
        assertEquals(23, helado.loggedAt.hour) // 21:40 UTC son las 23:40 en Madrid
    }

    @Test fun localDataFromAnotherAccountIsNotMixed() = runTest {
        val server = server()
        val phone = Device(server, StoreState(sync = SyncMeta(userId = "otra-cuenta")))
        phone.signIn()
        val error = assertFailsWith<SyncException> { phone.sync.sync(phone.store) }
        assertTrue("otra cuenta" in error.message!!)
    }

    @Test fun legacySequentialIdsBecomeUuidsKeepingTheLink() = runTest {
        val server = server()
        val phone = Device(server, StoreState(catalog = listOf(food(id = "f3")), entries = listOf(entry("f3", id = "e7"))))
        phone.signIn()
        phone.sync.sync(phone.store)
        val s = phone.store.state()
        assertTrue(isUuid(s.catalog.single().id) && isUuid(s.entries.single().id))
        assertEquals(s.catalog.single().id, s.entries.single().foodId)
        assertEquals(s.catalog.single().id, server.table("consumos").single()["alimento_ref_id"]!!.jsonPrimitive.content)
    }

    @Test fun labelsWithBarcodeAreContributedOnce() = runTest {
        val server = server()
        val label = FoodProfile(newId(), "Ketchup", "Salseo del burger", Macros(100.0, 1.3, 22.0, 0.0), source = ValueSource.LABEL, barcode = "8410000000017")
        val phone = Device(server, StoreState(catalog = listOf(label)))
        phone.signIn()
        assertEquals(1, phone.sync.sync(phone.store).contributed)
        assertEquals(0, phone.sync.sync(phone.store).contributed)
        val call = server.rpcCalls.single { it.first == "aportar_etiqueta" }.second
        assertEquals("8410000000017", call["p_codigo_barras"]!!.jsonPrimitive.content)
    }

    @Test fun expiredTokenIsRefreshedOnce() = runTest {
        val server = server()
        val phone = Device(server, StoreState(weighIns = listOf(WeighIn(WED, 92.0))))
        phone.signIn()
        server.expireNextToken = true
        phone.sync.sync(phone.store)
        assertEquals(1, server.table("pesajes").size)
    }

    @Test fun signUpAndWrongPassword() = runTest {
        val server = FakeSupabase()
        val client = SupabaseClient(SupabaseConfig(FAKE_URL, "anon"), server, InMemorySessionStore())
        val result = client.signUp("nuevo@example.com", "clave123")
        assertTrue(result is SignUpResult.SignedIn)
        client.signOut()
        assertNull(client.session)
        val error = assertFailsWith<SupabaseException> { client.signIn("nuevo@example.com", "mal") }
        assertEquals("Invalid login credentials", error.message)
    }

    @Test fun globalCatalogComesBeforeOpenFoodFacts() = runTest {
        val server = server()
        server.table("alimentos_global") += JsonObject(
            mapOf(
                "id" to JsonPrimitive("1"),
                "nombre" to JsonPrimitive("Leche desnatada"),
                "marca" to JsonPrimitive("Hacendado"),
                "supermercado" to JsonPrimitive("Mercadona"),
                "codigo_barras" to JsonPrimitive("8480000101457"),
                "kcal_100g" to JsonPrimitive(35),
                "proteinas_100g" to JsonPrimitive(3.4),
                "carbohidratos_100g" to JsonPrimitive(5),
                "grasas_100g" to JsonPrimitive(0.1),
                "base" to JsonPrimitive("100ml"),
                "con_nutricion" to JsonPrimitive(true),
            ),
        )
        val client = SupabaseClient(SupabaseConfig(FAKE_URL, "anon"), server, InMemorySessionStore())
        val off = object : FoodDatabase {
            override suspend fun search(query: String, limit: Int) = error("No debería llegar a Open Food Facts")
            override suspend fun byBarcode(code: String) = error("No debería llegar a Open Food Facts")
        }
        val chain = ChainedFoodDatabase(listOf(GlobalCatalog(client), off))

        val found = chain.search("leche desnatada", 5).single()
        assertEquals("el catálogo de MacrAI (Mercadona)", found.origin)
        assertEquals(Basis.PER_100ML, found.basis)
        assertNotNull(chain.byBarcode("8480000101457"))
    }

    @Test fun revokedSessionSignsOut() = runTest {
        val server = server()
        val phone = Device(server)
        phone.signIn()
        server.expireNextToken = true
        server.revokeRefresh = true
        assertFailsWith<SupabaseException> { phone.sync.sync(phone.store) }
        assertNull(phone.client.session)
    }
}
