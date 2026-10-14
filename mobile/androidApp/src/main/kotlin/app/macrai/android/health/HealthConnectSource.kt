package app.macrai.android.health

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import app.macrai.core.Expenditure
import app.macrai.core.ExpenditureSource
import app.macrai.core.WeighIn
import java.time.LocalDate as JavaDate
import java.time.ZoneId
import kotlinx.datetime.LocalDate
import kotlinx.datetime.toJavaLocalDate
import kotlinx.datetime.toKotlinLocalDate

// Samsung Health escribe peso, calorías totales y pasos en Health Connect: con esto ya no
// hace falta mandar capturas del reloj cada noche. Se mantiene la captura como respaldo,
// porque la sincronización de Samsung con Health Connect a veces llega tarde o incompleta.
//
// Google Play exige justificar cada tipo: peso y calorías alimentan el balance; los pasos
// explican el gasto de cada día en la pantalla Semana.

class HealthConnectSource(private val context: Context) {
    val permissions = setOf(
        HealthPermission.getReadPermission(WeightRecord::class),
        HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class),
    )

    val available: Boolean
        get() = HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE

    private val client by lazy { HealthConnectClient.getOrCreate(context) }

    suspend fun hasPermissions(): Boolean =
        client.permissionController.getGrantedPermissions().containsAll(permissions)

    /** Gasto total y pasos por día de calendario (el reloj cierra a medianoche). */
    suspend fun expenditures(from: LocalDate, to: LocalDate, zone: ZoneId = ZoneId.systemDefault()): List<Expenditure> {
        val result = mutableListOf<Expenditure>()
        var day: JavaDate = from.toJavaLocalDate()
        while (!day.isAfter(to.toJavaLocalDate())) {
            val range = TimeRangeFilter.between(day.atStartOfDay(zone).toInstant(), day.plusDays(1).atStartOfDay(zone).toInstant())
            val totals = client.aggregate(
                AggregateRequest(metrics = setOf(TotalCaloriesBurnedRecord.ENERGY_TOTAL, StepsRecord.COUNT_TOTAL), timeRangeFilter = range),
            )
            totals[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.let { energy ->
                result += Expenditure(
                    day = day.toKotlinLocalDate(),
                    totalKcal = energy.inKilocalories,
                    steps = totals[StepsRecord.COUNT_TOTAL]?.toInt(),
                    source = ExpenditureSource.HEALTH_CONNECT,
                )
            }
            day = day.plusDays(1)
        }
        return result
    }

    /** Primer pesaje de cada mañana: el de ayunas. */
    suspend fun morningWeighIns(from: LocalDate, to: LocalDate, zone: ZoneId = ZoneId.systemDefault()): List<WeighIn> {
        val records = client.readRecords(
            ReadRecordsRequest(
                recordType = WeightRecord::class,
                timeRangeFilter = TimeRangeFilter.between(
                    from.toJavaLocalDate().atStartOfDay(zone).toInstant(),
                    to.toJavaLocalDate().plusDays(1).atStartOfDay(zone).toInstant(),
                ),
            ),
        ).records
        return records
            .groupBy { it.time.atZone(zone).toLocalDate() }
            .map { (day, list) -> WeighIn(day.toKotlinLocalDate(), list.minBy { it.time }.weight.inKilograms) }
    }
}
