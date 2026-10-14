package app.macrai.android.ui.week

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.macrai.android.MacrAIApplication
import app.macrai.android.ui.chat.ReplyCard
import app.macrai.core.AssistantReply
import app.macrai.core.MIN_DAYS_FOR_MAINTENANCE
import app.macrai.core.ReplyBlock
import app.macrai.core.StoreState
import app.macrai.core.average
import app.macrai.core.buildDayBalance
import app.macrai.core.estimateMaintenance
import app.macrai.core.formatNumber
import app.macrai.core.weekBalance
import kotlinx.coroutines.launch
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.minus
import kotlinx.datetime.toKotlinLocalDate

// "Semana": balance contra el reloj, pesos y la estimación del mantenimiento (§9, §10).
// Los números salen del mismo motor que el chat, así que nunca se contradicen.

@Composable
fun WeekScreen(app: MacrAIApplication, modifier: Modifier = Modifier) {
    val state by app.store.flow.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf<String?>(null) }
    val today = java.time.LocalDate.now().toKotlinLocalDate()

    fun sync() = scope.launch {
        val from = today.minus(DatePeriod(days = 13))
        runCatching {
            val burns = app.health.expenditures(from, today)
            val weights = app.health.morningWeighIns(from, today)
            app.store.update { s ->
                s.copy(
                    expenditures = s.expenditures.filterNot { e -> burns.any { it.day == e.day } } + burns,
                    weighIns = s.weighIns.filterNot { w -> weights.any { it.day == w.day } } + weights,
                    // El último pesaje fija el mínimo de proteína (1,5 g/kg).
                    user = weights.maxByOrNull { it.day }?.let { s.user.copy(weightKg = it.kg) } ?: s.user,
                )
            }
            "Importados ${burns.size} días de gasto y ${weights.size} pesajes de Health Connect."
        }.onSuccess { status = it }.onFailure { status = "No he podido leer Health Connect: ${it.message}" }
    }

    val permissions = rememberLauncherForActivityResult(PermissionController.createRequestPermissionResultContract()) { granted ->
        if (granted.containsAll(app.health.permissions)) {
            sync()
        } else {
            status = "Sin permiso de Health Connect: sigue valiendo la captura del reloj."
        }
    }

    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Semana", style = MaterialTheme.typography.titleLarge)
        ReplyCard(AssistantReply(listOf(ReplyBlock.Title("Balance"), state.weekBalance(state.openDay ?: today))))

        val recent = state.weighIns.filter { it.day > today.minus(DatePeriod(days = 7)) }.sortedBy { it.day }
        ReplyCard(AssistantReply(listOf(ReplyBlock.Title("Peso en ayunas"), ReplyBlock.Weights(recent, average(recent)))))

        MaintenanceCard(state, today)

        if (app.health.available) {
            OutlinedButton(
                onClick = { scope.launch { if (app.health.hasPermissions()) sync() else permissions.launch(app.health.permissions) } },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Importar peso y gasto de Health Connect") }
        }
        status?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

@Composable
private fun MaintenanceCard(state: StoreState, today: LocalDate) {
    val firstWeek = state.weighIns.filter { it.day > today.minus(DatePeriod(days = 14)) && it.day <= today.minus(DatePeriod(days = 7)) }
    val lastWeek = state.weighIns.filter { it.day > today.minus(DatePeriod(days = 7)) }
    val balances = (0 until 14).map { today.minus(DatePeriod(days = it)) }
        .map { d -> buildDayBalance(d, state.entries, state.expenditures.firstOrNull { it.day == d }, null) }
    val estimate = average(firstWeek)?.let { a -> average(lastWeek)?.let { b -> estimateMaintenance(balances, a, b, daysBetweenAverages = 7) } }

    val text = when {
        estimate == null -> "Para estimar tu mantenimiento hacen falta dos semanas de pesajes y registro completo."
        !estimate.reliable -> "Con ${estimate.days} días completos sale ~${formatNumber(estimate.maintenanceKcal, 0)} kcal, " +
            "pero hacen falta al menos $MIN_DAYS_FOR_MAINTENANCE para fiarse."
        else -> "Mantenimiento real ~${formatNumber(estimate.maintenanceKcal, 0)} kcal/día" +
            (estimate.watchAccuracy?.let { ". El reloj acierta el ${formatNumber(it * 100, 0)} % del déficit que marca." } ?: ".")
    }
    ReplyCard(AssistantReply(listOf(ReplyBlock.Title("Mantenimiento"), ReplyBlock.Text(text))))
}
