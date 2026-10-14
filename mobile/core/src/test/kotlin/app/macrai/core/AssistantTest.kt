package app.macrai.core

import kotlinx.coroutines.test.runTest
import kotlinx.datetime.minus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

// El motor con un modelo falso: cada mensaje devuelve el JSON que daría el modelo.
// Comprueba lo que importa del documento: forma de la respuesta, cuentas y supuestos.

private class ScriptedModel(private val script: Map<String, String>) : LanguageModel {
    val tiers = mutableListOf<ModelTier>()
    var failOnDevice = false

    override suspend fun generate(request: ModelRequest): String {
        tiers += request.tier
        if (request.system != null) return "Respuesta de análisis"
        if (failOnDevice && request.tier == ModelTier.ON_DEVICE_PREFERRED) return "no sé"
        val message = request.prompt.substringAfterLast("Mensaje: ")
        return script[message] ?: error("Sin guion para: $message")
    }
}

private val CATALOG = listOf(
    FoodProfile("f-leche", "Leche desnatada", per100 = Macros(35.0, 3.4, 5.0, 0.1), basis = Basis.PER_100ML, source = ValueSource.ESTIMATE),
    FoodProfile("f-pan", "Pan", per100 = Macros(270.0, 8.5, 50.0, 3.5), source = ValueSource.ESTIMATE),
    FoodProfile("f-melo", "Melocotón", per100 = Macros(39.0, 1.0, 8.5, 0.3), source = ValueSource.ESTIMATE),
    FoodProfile("f-pepero", "Pepero de fresa", per100 = Macros(500.0, 6.0, 65.0, 24.0), unitWeightG = 5.0, source = ValueSource.ESTIMATE),
    FoodProfile("f-helado", "Helado mango choco", "Mercadona", Macros(238.0, 3.5, 31.0, 9.5), perUnit = Macros(238.0, 3.5, 31.0, 9.5), source = ValueSource.USER),
    FoodProfile("f-ketchup", "Ketchup light", per100 = Macros(20.0, 0.0, 5.0, 0.0), source = ValueSource.ESTIMATE),
)

private fun assistant(
    script: Map<String, String>,
    state: StoreState = StoreState(catalog = CATALOG, user = UserContext(weightKg = 92.0)),
): Pair<MacroAssistant, ScriptedModel> {
    val model = ScriptedModel(script)
    return MacroAssistant(InMemoryMacroStore(state), model, "DOC") to model
}

class AssistantTest {
    @Test fun replyAlwaysShowsWhatWasAddedMealAndFullDay() = runTest {
        val (bot, _) = assistant(
            mapOf(
                "Añade 150 de leche desnatada a la merienda" to
                    """{"acciones":[{"tipo":"anadir","comida":"merienda","items":[{"alimento":"leche desnatada","cantidad":150,"unidad":"ml"}]}]}""",
                "Añade 60 gramos de pan" to """{"acciones":[{"tipo":"anadir","items":[{"alimento":"pan","cantidad":60}]}]}""",
            ),
        )

        val first = bot.handle(UserMessage("Añade 150 de leche desnatada a la merienda", at(WED, 18, 0))).toMarkdown()
        assertTrue(first.startsWith("**Merienda añadida: + 150 g Leche desnatada**"), first)
        assertTrue("**Total día (miércoles, parcial):**" in first)
        Meal.entries.forEach { assertTrue(it.label in first, "falta ${it.label}") }
        assertTrue("| Desayuno | - | - | - | - |" in first)
        assertTrue("52,5" in first)

        // Sin comida en el mensaje: va a la del último registro y el título dice "actualizada".
        val second = bot.handle(UserMessage("Añade 60 gramos de pan", at(WED, 18, 10))).toMarkdown()
        assertTrue(second.startsWith("**Merienda actualizada: + 60 g Pan**"), second)
        // 52,5 + 162 = 214,5 en la merienda y en el día.
        assertTrue("**Merienda:**" in second)
        assertTrue("| **Total** | ~214,5 |" in second, second)
        assertTrue("Te faltan unos" in second)
        assertTrue(second.endsWith("¿Algo más en merienda o pasamos a cena?"))
    }

    @Test fun correctionRecalculatesFromEntries() = runTest {
        val (bot, _) = assistant(
            mapOf(
                "pan" to """{"acciones":[{"tipo":"anadir","comida":"comida","items":[{"alimento":"pan","cantidad":100}]}]}""",
                "eran 30" to """{"acciones":[{"tipo":"corregir_cantidad","objetivo":"pan","cantidad":30}]}""",
            ),
        )
        bot.handle(UserMessage("pan", at(WED, 14, 0)))
        val reply = bot.handle(UserMessage("eran 30", at(WED, 14, 5))).toMarkdown()
        assertTrue("Corregido: Pan, 100 g → 30 g" in reply, reply)
        assertTrue("| Kcal | 270 | 81 |" in reply, reply)
        assertTrue("| **Total** | ~81 |" in reply, reply)
    }

    @Test fun pitIsSubtractedAndCanBeUndone() = runTest {
        val (bot, _) = assistant(
            mapOf(
                "melocotón" to """{"acciones":[{"tipo":"anadir","items":[{"alimento":"melocotón","cantidad":220,"con_hueso":true}]}]}""",
                "ya era sin hueso" to """{"acciones":[{"tipo":"corregir_estado"}]}""",
            ),
        )
        val added = bot.handle(UserMessage("melocotón", at(WED, 11, 0))).toMarkdown()
        assertTrue("Resto el hueso (~15 g): cuento 205 g comestibles." in added, added)
        val fixed = bot.handle(UserMessage("ya era sin hueso", at(WED, 11, 2))).toMarkdown()
        assertTrue("205 g → 220 g" in fixed, fixed)
    }

    @Test fun sharedPackCountsOnlyWhatIAte() = runTest {
        val (bot, _) = assistant(
            mapOf("pepero" to """{"acciones":[{"tipo":"anadir","items":[{"alimento":"Pepero de fresa","cantidad":32,"otros_comieron_ud":2}]}]}"""),
        )
        val reply = bot.handle(UserMessage("pepero", at(WED, 17, 0))).toMarkdown()
        assertTrue("Supongo ~6 piezas y cuento 4 (~21 g)" in reply, reply)
    }

    @Test fun afterMidnightGoesToWednesdayDinner() = runTest {
        val start = StoreState(
            catalog = CATALOG,
            openDay = WED,
            entries = listOf(LogEntry("e0", WED, Meal.CENA, "Pan", 50.0, Macros(135.0, 4.3, 25.0, 1.8), loggedAt = at(WED, 22, 30))),
        )
        val (bot, _) = assistant(
            mapOf("helado" to """{"acciones":[{"tipo":"anadir","items":[{"alimento":"helado de choco mango","cantidad":1,"unidad":"ud"}]}]}"""),
            start,
        )
        val reply = bot.handle(UserMessage("helado", at(THU, 1, 28))).toMarkdown()
        assertTrue("Lo cuento en la cena del miércoles, porque son más de la 1:00 y aún no has cerrado el día." in reply, reply)
        assertTrue("Cena actualizada" in reply)
        assertTrue("Helado mango choco Mercadona (1 ud)" in reply, reply)
        assertTrue("| **Total** | ~373 |" in reply, reply)
    }

    @Test fun labelOfAnotherKetchupIsSavedApartAndUsed() = runTest {
        val (bot, _) = assistant(
            mapOf(
                "ketchup" to """{"acciones":[{"tipo":"anadir","items":[{"alimento":"ketchup light","cantidad":30,
                    "etiqueta":{"nombre":"Ketchup","marca":"Salseo del burger","por_100":{"kcal":100,"p":1.3,"c":22,"g":0}}}]}]}""",
            ),
        )
        val reply = bot.handle(UserMessage("ketchup", at(WED, 14, 0), ocrText = "Valor energético 100 kcal")).toMarkdown()
        assertTrue("No es el mismo producto que «Ketchup light»" in reply, reply)
        assertTrue("+ 30 g Ketchup Salseo del burger" in reply, reply)
        assertTrue("| Kcal | 30 |" in reply, reply)
    }

    @Test fun missingQuantityIsAskedOnceAndAnsweredWithABareNumber() = runTest {
        val (bot, model) = assistant(
            mapOf(
                "merienda de leche y 60 de pan" to """{"acciones":[{"tipo":"anadir","comida":"merienda","items":[
                    {"alimento":"leche desnatada"},{"alimento":"pan","cantidad":60}]}]}""",
                "150" to """{"acciones":[{"tipo":"anadir","items":[{"alimento":"leche desnatada","cantidad":150,"unidad":"ml"}]}]}""",
            ),
        )
        val first = bot.handle(UserMessage("merienda de leche y 60 de pan", at(WED, 18, 0))).toMarkdown()
        assertTrue("+ 60 g Pan" in first)
        assertTrue(first.endsWith("¿Cuántos gramos de leche desnatada?"), first)
        val second = bot.handle(UserMessage("150", at(WED, 18, 2))).toMarkdown()
        assertTrue("+ 150 g Leche desnatada" in second, second)
        assertEquals(listOf(ModelTier.ON_DEVICE_PREFERRED, ModelTier.ON_DEVICE_PREFERRED), model.tiers)
    }

    @Test fun weighInOpensTheDayAndDoesNotConcludeWithFewDays() = runTest {
        val start = StoreState(catalog = CATALOG, openDay = WED, weighIns = listOf(WeighIn(WED, 93.0)))
        val store = InMemoryMacroStore(start)
        val bot = MacroAssistant(store, ScriptedModel(mapOf("92,6" to """{"acciones":[{"tipo":"peso","kg":92.6}]}""")), "DOC")
        val reply = bot.handle(UserMessage("92,6", at(THU, 8, 0))).toMarkdown()
        assertTrue("Peso del jueves: 92,6 kg" in reply, reply)
        assertTrue("-0,4 kg desde el miércoles." in reply, reply)
        assertTrue("Con menos de 7 días" in reply)
        assertEquals(139.0, store.state().user.proteinMinimum)
    }

    @Test fun onDeviceFailureFallsBackToCloudAndAnalysisGoesToCloud() = runTest {
        val (bot, model) = assistant(
            mapOf(
                "pan" to """{"acciones":[{"tipo":"anadir","items":[{"alimento":"pan","cantidad":50}]}]}""",
                "¿vamos bien?" to """{"acciones":[{"tipo":"analisis","pregunta":"¿vamos bien?"}]}""",
            ),
        )
        model.failOnDevice = true
        val reply = bot.handle(UserMessage("pan", at(WED, 14, 0)))
        assertNotNull(reply.blocks.firstOrNull { it is ReplyBlock.DayTotal })
        assertEquals(listOf(ModelTier.ON_DEVICE_PREFERRED, ModelTier.CLOUD), model.tiers)

        model.failOnDevice = false
        val analysis = bot.handle(UserMessage("¿vamos bien?", at(WED, 14, 5))).toMarkdown()
        assertEquals("Respuesta de análisis", analysis)
        assertEquals(ModelTier.CLOUD, model.tiers.last())
    }

    @Test fun watchScreenshotThenCloseShowsFinalDayAndWeekBalance() = runTest {
        val monday = WED.minus(kotlinx.datetime.DatePeriod(days = 2))
        val start = StoreState(
            catalog = CATALOG,
            openDay = WED,
            user = UserContext(weightKg = 92.0, dailyDeficitTarget = 500.0),
            expenditures = listOf(Expenditure(monday, 3038.0, source = ExpenditureSource.SCREENSHOT)),
            entries = listOf(
                LogEntry("e1", monday, Meal.COMIDA, "Comida", 0.0, Macros(kcal = 2042.0), source = ValueSource.LABEL, loggedAt = at(monday, 14, 0)),
                LogEntry("e2", WED, Meal.COMIDA, "Pan", 100.0, Macros(270.0, 8.5, 50.0, 3.5), source = ValueSource.LABEL, loggedAt = at(WED, 14, 0)),
            ),
        )
        val (bot, _) = assistant(
            mapOf(
                "captura" to """{"acciones":[{"tipo":"gasto","kcal":2770,"fecha":"2026-10-07"}]}""",
                "cerramos" to """{"acciones":[{"tipo":"cerrar_dia"}]}""",
            ),
            start,
        )
        val burn = bot.handle(UserMessage("captura", at(THU, 0, 40))).toMarkdown()
        assertTrue("Gasto del miércoles: 2.770 kcal" in burn, burn)
        assertTrue("| Lunes | 3.038 | 2.042 | 996 | 500 | +496 |" in burn, burn)
        assertTrue("Balance provisional" in burn)

        val close = bot.handle(UserMessage("cerramos", at(THU, 0, 45))).toMarkdown()
        assertTrue("**Total día (miércoles, FINAL):**" in close, close)
        assertTrue("| Miércoles | 2.770 | 270 | 2.500 | 500 | +2.000 |" in close, close)
        assertTrue("| **Acumulado** |  |  | **~3.496** |  | **+2.496** |" in close, close)
    }

    @Test fun twoFoodsInANewMealSayAdded() = runTest {
        val (bot, _) = assistant(
            mapOf("merienda" to """{"acciones":[{"tipo":"anadir","comida":"merienda","items":[
                {"alimento":"leche desnatada","cantidad":150,"unidad":"ml"},{"alimento":"pan","cantidad":65}]}]}"""),
        )
        val reply = bot.handle(UserMessage("merienda", at(WED, 18, 0))).toMarkdown()
        assertTrue(reply.startsWith("**Merienda añadida: + 150 g Leche desnatada + 65 g Pan**"), reply)
    }
}
