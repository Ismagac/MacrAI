package app.macrai.core

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

// Base de productos (Open Food Facts) y alias aprendidos, con modelo y base falsos.

private class FakeFoods(private val products: List<FoodProfile>) : FoodDatabase {
    val queries = mutableListOf<String>()

    override suspend fun search(query: String, limit: Int): List<FoodProfile> {
        queries += query
        return products.filter { it.bestScore(query) >= MIN_MATCH_SCORE }.take(limit)
    }

    override suspend fun byBarcode(code: String): FoodProfile? {
        queries += "ean:$code"
        return products.firstOrNull { it.barcode == code }
    }
}

private class JsonModel(private val script: Map<String, String>) : LanguageModel {
    override suspend fun generate(request: ModelRequest): String =
        script[request.prompt.substringAfterLast("Mensaje: ")] ?: error("Sin guion")
}

private val PAVO_HACENDADO = FoodProfile(
    "off:8480000123456", "Pechuga de pavo finas lonchas", "Hacendado",
    Macros(70.0, 15.0, 1.0, 0.8), source = ValueSource.WEB, barcode = "8480000123456", packFormat = "250 g",
)

class ProductsAndAliasesTest {
    @Test fun brandedFoodNotInCatalogComesFromProductDatabaseOnce() = runTest {
        val foods = FakeFoods(listOf(PAVO_HACENDADO))
        val store = InMemoryMacroStore()
        val pavo = """{"acciones":[{"tipo":"anadir","comida":"comida","items":[{"alimento":"pechuga de pavo","marca":"Hacendado","cantidad":50,
            "estimacion_100":{"kcal":100,"p":20,"c":2,"g":2}}]}]}"""
        val bot = MacroAssistant(store, JsonModel(mapOf("pavo" to pavo, "otra vez pavo" to pavo)), "DOC", foods)

        val reply = bot.handle(UserMessage("pavo", at(WED, 14, 0))).toMarkdown()
        assertTrue("valores de Open Food Facts (código 8480000123456)" in reply, reply)
        assertTrue("| Kcal | 35 |" in reply, reply)
        val saved = assertNotNull(store.state().catalog.singleOrNull())
        assertEquals("8480000123456", saved.barcode)
        assertEquals(ValueSource.WEB, saved.source)

        // La segunda vez sale del catálogo personal: no vuelve a consultar la base.
        bot.handle(UserMessage("otra vez pavo", at(WED, 14, 5)))
        assertEquals(1, foods.queries.size)
    }

    @Test fun genericFoodIsEstimatedWithoutSearching() = runTest {
        val foods = FakeFoods(listOf(PAVO_HACENDADO))
        val bot = MacroAssistant(
            InMemoryMacroStore(),
            JsonModel(mapOf("pollo" to """{"acciones":[{"tipo":"anadir","items":[{"alimento":"pechuga de pollo","cantidad":150,
                "estimacion_100":{"kcal":110,"p":23,"c":0,"g":1.5}}]}]}""")),
            "DOC",
            foods,
        )
        val reply = bot.handle(UserMessage("pollo", at(WED, 14, 0))).toMarkdown()
        assertTrue("estimado a 110 kcal/100 g" in reply, reply)
        assertEquals(emptyList(), foods.queries)
    }

    @Test fun barcodeInPhotoIdentifiesTheProduct() = runTest {
        val foods = FakeFoods(listOf(PAVO_HACENDADO))
        val store = InMemoryMacroStore()
        val bot = MacroAssistant(
            store,
            JsonModel(mapOf("30 de esto" to """{"acciones":[{"tipo":"anadir","items":[{"alimento":"embutido","cantidad":30}]}]}""")),
            "DOC",
            foods,
        )
        val reply = bot.handle(UserMessage("30 de esto", at(WED, 10, 0), barcode = "8480000123456")).toMarkdown()
        assertTrue("+ 30 g Pechuga de pavo finas lonchas Hacendado" in reply, reply)
        assertEquals(listOf("ean:8480000123456"), foods.queries)
    }

    @Test fun repeatedNicknameIsProposedAsAliasAndSavedOnYes() = runTest {
        val carne = FoodProfile("f1", "Carne picada de ternera", "Mercadona", Macros(190.0, 18.0, 2.4, 12.0), source = ValueSource.LABEL)
        val store = InMemoryMacroStore(StoreState(catalog = listOf(carne), nextId = 10))
        val add = """{"acciones":[{"tipo":"anadir","comida":"comida","items":[{"alimento":"carne picada de ternera","dicho":"la de Mercadona","cantidad":100}]}]}"""
        val bot = MacroAssistant(
            store,
            JsonModel(mapOf("uno" to add, "dos" to add, "sí" to """{"acciones":[{"tipo":"responder","si":true}]}""")),
            "DOC",
        )

        val first = bot.handle(UserMessage("uno", at(WED, 14, 0))).toMarkdown()
        assertTrue("te refieres siempre" !in first)
        val second = bot.handle(UserMessage("dos", at(WED, 14, 10))).toMarkdown()
        assertTrue(second.endsWith("Cuando dices «la de Mercadona», ¿te refieres siempre a Carne picada de ternera Mercadona? Si me dices que sí, lo guardo como alias."), second)

        val yes = bot.handle(UserMessage("sí", at(WED, 14, 11))).toMarkdown()
        assertTrue("Hecho: cuando digas «la de Mercadona» entiendo Carne picada de ternera Mercadona." in yes, yes)
        assertEquals(listOf("la de Mercadona"), store.state().catalog.single().aliases)
        assertTrue(store.state().pending.isEmpty())
    }

    @Test fun catalogQueryFallsBackToProductDatabaseAndSaves() = runTest {
        val store = InMemoryMacroStore()
        val bot = MacroAssistant(
            store,
            JsonModel(mapOf("¿tienes el pavo?" to """{"acciones":[{"tipo":"consultar_catalogo","alimento":"pechuga de pavo finas lonchas"}]}""")),
            "DOC",
            FakeFoods(listOf(PAVO_HACENDADO)),
        )
        val reply = bot.handle(UserMessage("¿tienes el pavo?", at(WED, 14, 0))).toMarkdown()
        assertTrue("No lo tenía, pero en Open Food Facts está Pechuga de pavo finas lonchas Hacendado (250 g)" in reply, reply)
        assertTrue(reply.endsWith("¿Cuánto y en qué comida?"))
        assertEquals("8480000123456", store.state().catalog.single().barcode)
    }

    @Test fun barcodePhotoWithoutQuantityIdentifiesAndAsks() = runTest {
        val store = InMemoryMacroStore()
        val bot = MacroAssistant(
            store,
            JsonModel(mapOf("Te paso esta foto." to """{"acciones":[{"tipo":"charla","respuesta":"Vale."}]}""")),
            "DOC",
            FakeFoods(listOf(PAVO_HACENDADO)),
        )
        val reply = bot.handle(UserMessage("Te paso esta foto.", at(WED, 10, 0), barcode = "8480000123456")).toMarkdown()
        assertTrue("**Pechuga de pavo finas lonchas Hacendado (250 g)**" in reply, reply)
        assertTrue("Lo he encontrado en Open Food Facts" in reply, reply)
        assertTrue(reply.endsWith("¿Cuánto has tomado y en qué comida?"), reply)
        assertEquals(1, store.state().catalog.size)
    }
}
