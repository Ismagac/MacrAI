package app.macrai.core

import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.isoDayNumber
import kotlinx.datetime.minus
import kotlinx.datetime.plus

// Balance diario y semanal contra el gasto del reloj (§10) e interpretación del peso (§9).

/** kcal por kg de grasa. */
const val KCAL_PER_KG_FAT = 7700.0

/** Días de registro completo que hacen falta para estimar el mantenimiento (§10.3). */
const val MIN_DAYS_FOR_MAINTENANCE = 10

data class DayBalance(
    val day: LocalDate,
    val expenditure: Double?,
    val intake: Double,
    val target: Double?,
    /** Días con cenas "a ojo" o sin reloj: menos fiables (§10.2). */
    val estimated: Boolean,
) {
    val deficit: Double? get() = expenditure?.let { it - intake }
    val vsTarget: Double? get() = deficit?.let { d -> target?.let { d - it } }
}

data class PeriodBalance(val days: List<DayBalance>) {
    private val measured = days.filter { it.deficit != null }

    val accumulatedDeficit: Double get() = measured.sumOf { it.deficit!! }

    /**
     * Contra el objetivo solo cuentan los días con objetivo: mezclar en una misma cuenta
     * déficit contra mantenimiento y contra objetivo fue el error real del §2.12.
     */
    val accumulatedVsTarget: Double? get() =
        measured.filter { it.target != null }.takeIf { it.isNotEmpty() }?.sumOf { it.vsTarget!! }

    val theoreticalFatKg: Double get() = accumulatedDeficit / KCAL_PER_KG_FAT

    /** Lo que falta para el objetivo del periodo, repartido entre los días que quedan. */
    fun remainingPerDay(periodTarget: Double, daysLeft: Int): Double? =
        if (daysLeft <= 0) null else (periodTarget - accumulatedDeficit) / daysLeft
}

fun mondayOf(day: LocalDate): LocalDate = day.minus(DatePeriod(days = day.dayOfWeek.isoDayNumber - 1))

/** Semana de lunes a [day], con los días que tienen comida o gasto. Mismo cálculo en chat y pantallas. */
fun StoreState.weekBalance(day: LocalDate): ReplyBlock.Balance {
    val target = user.dailyDeficitTarget
    val days = generateSequence(mondayOf(day)) { it.plus(DatePeriod(days = 1)) }
        .takeWhile { it <= day }
        .map { d -> buildDayBalance(d, entries, expenditures.firstOrNull { it.day == d }, target) }
        .filter { it.intake > 0 || it.expenditure != null }
        .toList()
    return ReplyBlock.Balance(days, PeriodBalance(days), showTarget = target != null)
}

fun buildDayBalance(
    day: LocalDate,
    entries: List<LogEntry>,
    expenditure: Expenditure?,
    target: Double?,
): DayBalance {
    val dayEntries = entries.filter { it.day == day }
    return DayBalance(
        day = day,
        expenditure = expenditure?.totalKcal,
        intake = dayEntries.sumOf { it.macros.kcal },
        target = target,
        estimated = expenditure == null || dayEntries.any { it.isEstimate },
    )
}

/**
 * Un cambio de peso frente a lo que permite el déficit: casi nunca es grasa (§9.2).
 * Ejemplo real: −2,8 kg en 4 días con ~2.300 kcal de déficit ≈ 0,3 kg de grasa.
 */
data class WeightChangeReading(val changeKg: Double, val fatKg: Double) {
    /** Lo que no explica la grasa: agua, glucógeno y contenido intestinal. */
    val nonFatKg: Double get() = changeKg - fatKg
}

fun readWeightChange(changeKg: Double, balanceKcal: Double): WeightChangeReading =
    // Un déficit (balance positivo) quita grasa; un superávit la añade.
    WeightChangeReading(changeKg = changeKg, fatKg = -balanceKcal / KCAL_PER_KG_FAT)

fun average(weighIns: List<WeighIn>): Double? =
    weighIns.takeIf { it.isNotEmpty() }?.map { it.kg }?.average()

data class MaintenanceEstimate(
    val maintenanceKcal: Double,
    /** Déficit real según báscula ÷ déficit que marca el reloj; <1 si el reloj sobrestima. */
    val watchAccuracy: Double?,
    val days: Int,
    val reliable: Boolean,
)

/**
 * Mantenimiento real ≈ ingesta media + (kg perdidos entre medias semanales × 7.700 ÷ días).
 * Necesita 10-14 días con registro completo y pesajes casi diarios.
 */
fun estimateMaintenance(
    balances: List<DayBalance>,
    firstWeekAvgKg: Double,
    lastWeekAvgKg: Double,
    daysBetweenAverages: Int,
): MaintenanceEstimate? {
    val complete = balances.filter { !it.estimated }
    if (complete.isEmpty() || daysBetweenAverages <= 0) return null

    val avgIntake = complete.map { it.intake }.average()
    val lostKg = firstWeekAvgKg - lastWeekAvgKg
    val realDailyDeficit = lostKg * KCAL_PER_KG_FAT / daysBetweenAverages
    val watchDailyDeficit = complete.mapNotNull { it.deficit }.takeIf { it.isNotEmpty() }?.average()

    return MaintenanceEstimate(
        maintenanceKcal = avgIntake + realDailyDeficit,
        watchAccuracy = watchDailyDeficit?.takeIf { it != 0.0 }?.let { realDailyDeficit / it },
        days = complete.size,
        reliable = complete.size >= MIN_DAYS_FOR_MAINTENANCE,
    )
}
