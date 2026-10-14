package app.macrai.core

import kotlinx.datetime.DatePeriod
import kotlinx.datetime.DayOfWeek
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.minus

// Frontera del día (§2.11) y asignación de comida (§4).
// El usuario cena tarde y sigue comiendo de madrugada: el día no cambia a medianoche.

/** Hueco mínimo, típicamente de sueño, para dar el día por cambiado sin que lo diga. */
const val SLEEP_GAP_MINUTES = 5 * 60

/** Antes de esta hora, un primer registro sin historial cuenta para el día anterior. */
const val DAY_ROLLOVER_HOUR = 5

enum class DaySignal { NONE, EXPLICIT_NEW_DAY, MORNING_WEIGH_IN }

enum class DayReason {
    FIRST_ENTRY,
    SAME_DAY,
    /** Pasada la medianoche sin cerrar el día: va a la cena del día anterior. */
    AFTER_MIDNIGHT,
    NEW_DAY_EXPLICIT,
    NEW_DAY_WEIGH_IN,
    NEW_DAY_AFTER_SLEEP,
}

data class DayDecision(val day: LocalDate, val reason: DayReason) {
    val startsNewDay: Boolean
        get() = reason == DayReason.NEW_DAY_EXPLICIT ||
            reason == DayReason.NEW_DAY_WEIGH_IN ||
            reason == DayReason.NEW_DAY_AFTER_SLEEP
}

internal fun LocalDateTime.minuteIndex(): Long =
    date.toEpochDays().toLong() * 24 * 60 + hour * 60 + minute

fun minutesBetween(from: LocalDateTime, to: LocalDateTime): Long = to.minuteIndex() - from.minuteIndex()

/**
 * Decide a qué día va lo que llega ahora.
 *
 * El día cambia con lo primero de: el usuario lo dice, envía el peso en ayunas, o hay un
 * hueco de sueño y lo siguiente es claramente un desayuno. Mientras tanto, se sigue en el
 * día abierto aunque el reloj haya pasado de medianoche.
 */
fun resolveLogDay(
    now: LocalDateTime,
    openDay: LocalDate?,
    lastEntryAt: LocalDateTime?,
    signal: DaySignal = DaySignal.NONE,
    explicitMeal: Meal? = null,
): DayDecision {
    if (openDay == null) {
        val day = if (now.hour < DAY_ROLLOVER_HOUR) now.date.minus(DatePeriod(days = 1)) else now.date
        return DayDecision(day, DayReason.FIRST_ENTRY)
    }

    val nextDay = maxOf(now.date, openDay)
    when (signal) {
        DaySignal.EXPLICIT_NEW_DAY -> return DayDecision(nextDay, DayReason.NEW_DAY_EXPLICIT)
        DaySignal.MORNING_WEIGH_IN ->
            if (now.date > openDay) return DayDecision(now.date, DayReason.NEW_DAY_WEIGH_IN)
        DaySignal.NONE -> Unit
    }

    if (now.date > openDay && lastEntryAt != null) {
        val slept = minutesBetween(lastEntryAt, now) >= SLEEP_GAP_MINUTES
        val looksLikeBreakfast = explicitMeal == Meal.DESAYUNO ||
            (explicitMeal == null && now.hour in DAY_ROLLOVER_HOUR..11)
        if (slept && looksLikeBreakfast) return DayDecision(now.date, DayReason.NEW_DAY_AFTER_SLEEP)
    }

    return if (now.date > openDay) {
        DayDecision(openDay, DayReason.AFTER_MIDNIGHT)
    } else {
        DayDecision(openDay, DayReason.SAME_DAY)
    }
}

/**
 * "La cena de ayer", "anoche": relativo al día de registro, no al calendario. A la 1:00
 * sin haber dormido, "anoche" es el día que sigue abierto.
 */
fun resolvePreviousDay(now: LocalDateTime, current: DayDecision): LocalDate =
    if (current.reason == DayReason.AFTER_MIDNIGHT && current.day < now.date) {
        current.day
    } else {
        current.day.minus(DatePeriod(days = 1))
    }

enum class MealReason {
    EXPLICIT,
    /** Sin comida en el mensaje: la del último registro del día. */
    LAST_ENTRY,
    /** Igual que LAST_ENTRY, pero la hora sugiere otra comida y conviene decirlo. */
    LAST_ENTRY_DOUBTFUL,
    FIRST_AFTER_SLEEP,
    BY_CLOCK,
}

data class MealDecision(val meal: Meal, val reason: MealReason, val clockSuggests: Meal? = null)

/** Hueco a partir del cual la hora puede contradecir a la última comida registrada. */
const val MEAL_DOUBT_MINUTES = 150

fun mealForClock(time: LocalDateTime): Meal {
    val minutes = time.hour * 60 + time.minute
    return when {
        time.hour < DAY_ROLLOVER_HOUR -> Meal.CENA
        minutes < 11 * 60 -> Meal.DESAYUNO
        minutes < 13 * 60 + 30 -> Meal.MEDIA_MANANA
        minutes < 16 * 60 + 30 -> Meal.COMIDA
        minutes < 20 * 60 + 30 -> Meal.MERIENDA
        else -> Meal.CENA
    }
}

/** Nunca bloquea un registro para preguntar la comida (§4). */
fun resolveMeal(
    now: LocalDateTime,
    explicit: Meal?,
    day: DayDecision,
    lastEntry: LogEntry?,
): MealDecision {
    if (explicit != null) return MealDecision(explicit, MealReason.EXPLICIT)
    if (day.startsNewDay) return MealDecision(Meal.DESAYUNO, MealReason.FIRST_AFTER_SLEEP)

    val last = lastEntry?.takeIf { it.day == day.day }
        ?: return MealDecision(mealForClock(now), MealReason.BY_CLOCK)

    val clock = mealForClock(now)
    val doubtful = minutesBetween(last.loggedAt, now) >= MEAL_DOUBT_MINUTES &&
        clock.ordinal > last.meal.ordinal
    return if (doubtful) {
        MealDecision(last.meal, MealReason.LAST_ENTRY_DOUBTFUL, clockSuggests = clock)
    } else {
        MealDecision(last.meal, MealReason.LAST_ENTRY)
    }
}

fun DayOfWeek.spanishName(): String = when (this) {
    DayOfWeek.MONDAY -> "lunes"
    DayOfWeek.TUESDAY -> "martes"
    DayOfWeek.WEDNESDAY -> "miércoles"
    DayOfWeek.THURSDAY -> "jueves"
    DayOfWeek.FRIDAY -> "viernes"
    DayOfWeek.SATURDAY -> "sábado"
    DayOfWeek.SUNDAY -> "domingo"
}
