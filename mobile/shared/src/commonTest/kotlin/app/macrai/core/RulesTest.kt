package app.macrai.core

import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.LocalTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

// Casos reales del documento de comportamiento, sin modelo de por medio.

internal val WED = LocalDate(2026, 10, 7)
internal val THU = LocalDate(2026, 10, 8)

internal fun at(day: LocalDate, hour: Int, minute: Int = 0) = LocalDateTime(day, LocalTime(hour, minute))

private fun entry(meal: Meal, time: LocalDateTime, day: LocalDate = time.date) =
    LogEntry("e", day, meal, "x", 100.0, Macros(100.0, 5.0, 10.0, 4.0), loggedAt = time)

class FormatTest {
    @Test fun spanishThousandsAndDecimals() {
        assertEquals("1.963,5", formatNumber(1963.5))
        assertEquals("43", formatNumber(42.9875, 0))
        assertEquals("114", formatNumber(114.0))
        assertEquals("1.234.567,3", formatNumber(1234567.25))
        assertEquals("+496", formatSigned(496.0))
        assertEquals("-2,8", formatNumber(-2.8))
    }
}

class LabelTest {
    @Test fun coveredKcalAreConfirmedByMacros() {
        // Pavo: la energía estaba tapada por una pegatina; 3×9 + 9×4 + 9,5×4 = 101.
        assertEquals(101.0, kcalFromMacros(Macros(0.0, protein = 9.5, carbs = 9.0, fat = 3.0)))
    }

    @Test fun shiftedRowIsTheReadingThatDoesNotAddUp() {
        val right = Macros(172.0, protein = 6.3, carbs = 5.0, fat = 14.0)
        val shifted = Macros(172.0, protein = 5.0, carbs = 14.0, fat = 6.3)
        assertTrue(checkLabel(right).consistent)
        assertFalse(checkLabel(shifted).consistent)
        assertEquals(right, pickConsistentReading(listOf(shifted, right)))
    }

    @Test fun juiceWithMilkAt14KcalIsFlaggedAsLow() {
        assertEquals(Plausibility.UNUSUALLY_LOW, plausibility(Macros(14.0, 0.4, 2.9, 0.1), FoodKind.DAIRY_DRINK))
        assertEquals(Plausibility.IMPOSSIBLE, plausibility(Macros(950.0, 0.0, 0.0, 100.0)))
    }
}

class LogDayTest {
    @Test fun afterMidnightGoesToPreviousDinner() {
        val d = resolveLogDay(now = at(THU, 1, 28), openDay = WED, lastEntryAt = at(WED, 23, 40))
        assertEquals(DayDecision(WED, DayReason.AFTER_MIDNIGHT), d)
    }

    @Test fun watchScreenshotAt0433StillCountsForPreviousDay() {
        val d = resolveLogDay(now = at(THU, 4, 33), openDay = WED, lastEntryAt = at(WED, 22, 0))
        assertEquals(WED, d.day)
    }

    @Test fun morningWeighInOpensTheNewDay() {
        val d = resolveLogDay(at(THU, 8, 5), WED, at(THU, 1, 30), DaySignal.MORNING_WEIGH_IN)
        assertEquals(DayDecision(THU, DayReason.NEW_DAY_WEIGH_IN), d)
    }

    @Test fun sleepGapThenBreakfastStartsNewDay() {
        val d = resolveLogDay(at(THU, 9, 15), WED, at(THU, 0, 30))
        assertEquals(DayDecision(THU, DayReason.NEW_DAY_AFTER_SLEEP), d)
    }

    @Test fun firstEntryBeforeFiveCountsForYesterday() {
        assertEquals(WED, resolveLogDay(at(THU, 2, 0), null, null).day)
    }

    @Test fun yesterdayIsRelativeToTheLogDay() {
        val morning = resolveLogDay(at(THU, 9, 0), THU, at(THU, 8, 30))
        assertEquals(WED, resolvePreviousDay(at(THU, 9, 0), morning))
        // A la 1:00 sin dormir, "anoche" es el día que sigue abierto.
        val night = resolveLogDay(at(THU, 1, 0), WED, at(WED, 23, 0))
        assertEquals(WED, resolvePreviousDay(at(THU, 1, 0), night))
    }
}

class MealTest {
    private val sameDay = DayDecision(WED, DayReason.SAME_DAY)

    @Test fun nectarineAnHourAfterLunchGoesToLunch() {
        val m = resolveMeal(at(WED, 17, 0), null, sameDay, entry(Meal.COMIDA, at(WED, 16, 5)))
        assertEquals(MealDecision(Meal.COMIDA, MealReason.LAST_ENTRY), m)
    }

    @Test fun longGapKeepsLastMealButSaysSo() {
        val m = resolveMeal(at(WED, 19, 30), null, sameDay, entry(Meal.COMIDA, at(WED, 15, 0)))
        assertEquals(Meal.COMIDA, m.meal)
        assertEquals(Meal.MERIENDA, m.clockSuggests)
    }

    @Test fun explicitMealWinsEvenIfAnotherIsOpen() {
        val m = resolveMeal(at(WED, 18, 0), Meal.COMIDA, sameDay, entry(Meal.MERIENDA, at(WED, 17, 50)))
        assertEquals(MealDecision(Meal.COMIDA, MealReason.EXPLICIT), m)
    }

    @Test fun firstEntryAfterSleepIsBreakfast() {
        val m = resolveMeal(at(THU, 9, 0), null, DayDecision(THU, DayReason.NEW_DAY_AFTER_SLEEP), entry(Meal.CENA, at(THU, 0, 30), WED))
        assertEquals(Meal.DESAYUNO, m.meal)
    }
}

class FoodMatchTest {
    private val catalog = listOf(
        FoodProfile("1", "Jamón", "Duriber", Macros(181.0, 28.0, 0.8, 7.9), source = ValueSource.LABEL),
        FoodProfile("2", "Leche desnatada", per100 = Macros(35.0, 3.4, 5.0, 0.1), basis = Basis.PER_100ML, source = ValueSource.ESTIMATE),
        FoodProfile("3", "Queso cottage", "Margui", Macros(66.0, 11.0, 3.3, 1.3), source = ValueSource.USER),
        FoodProfile("4", "Ketchup light", per100 = Macros(20.0, 0.0, 5.0, 0.0), source = ValueSource.ESTIMATE),
        FoodProfile("5", "Ketchup", "Salseo del burger", Macros(100.0, 1.3, 22.0, 0.0), source = ValueSource.LABEL),
    )

    @Test fun voiceTyposFindTheCatalogFood() {
        assertEquals("1", findInCatalog("jam", catalog, emptyList())?.id)
        assertEquals("2", findInCatalog("leche deslatada", catalog, emptyList())?.id)
        assertEquals("3", findInCatalog("cottage magri", catalog, emptyList())?.id)
    }

    @Test fun exactNameBeatsSimilarOnes() {
        assertEquals("4", findInCatalog("ketchup light", catalog, emptyList())?.id)
    }

    @Test fun labelOfAnotherProductIsSavedApart() {
        val label = FoodProfile("9", "Queso fresco blanco", "entero", Macros(144.0, 10.0, 3.5, 10.0), source = ValueSource.LABEL)
        val batido = FoodProfile("8", "Queso fresco batido 0 %", per100 = Macros(46.0, 7.5, 4.0, 0.2), source = ValueSource.USER)
        val choice = mergeLabelIntoCatalog(label, listOf(batido), userName = "queso fresco batido")
        assertTrue(choice.isNew)
        assertTrue(choice.notes.single().contains("No es el mismo producto"))
    }
}

class BalanceTest {
    @Test fun deficitAgainstTarget() {
        val b = DayBalance(LocalDate(2026, 10, 5), expenditure = 3038.0, intake = 2042.0, target = 500.0, estimated = false)
        assertEquals(996.0, b.deficit)
        assertEquals(496.0, b.vsTarget)
    }

    @Test fun fastWeightLossIsMostlyWater() {
        val r = readWeightChange(changeKg = -2.8, balanceKcal = 2300.0)
        assertEquals(-0.3, roundTo(r.fatKg, 1))
        assertEquals(-2.5, roundTo(r.nonFatKg, 1))
    }

    @Test fun maintenanceFromScaleAndWatch() {
        val days = (1..14).map { DayBalance(LocalDate(2026, 9, it), 2600.0, 2000.0, null, false) }
        val m = assertNotNull(estimateMaintenance(days, firstWeekAvgKg = 92.0, lastWeekAvgKg = 91.5, daysBetweenAverages = 7))
        assertEquals(2550.0, m.maintenanceKcal)
        assertEquals(0.917, roundTo(m.watchAccuracy!!, 3))
        assertTrue(m.reliable)
    }
}
