package app.macrai.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.macrai.android.MacrAIApplication
import app.macrai.android.ui.common.NumberField
import app.macrai.android.ui.common.asField
import app.macrai.android.ui.common.toNumberOrNull
import app.macrai.core.StoreState
import app.macrai.core.formatNumber
import kotlinx.coroutines.launch

// "Ajustes": el contexto personal que usa el asistente (§15 del documento de comportamiento).
// El peso fija el mínimo de proteína; el déficit objetivo decide si el balance muestra las
// columnas de objetivo y diferencia (§10.2).

@Composable
fun SettingsScreen(app: MacrAIApplication, modifier: Modifier = Modifier) {
    val state by app.store.flow.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val user = state.user

    var weight by remember { mutableStateOf(user.weightKg.asField()) }
    var proteinPerKg by remember { mutableStateOf(user.proteinPerKg.asField()) }
    var useTarget by remember { mutableStateOf(user.dailyDeficitTarget != null) }
    var target by remember { mutableStateOf((user.dailyDeficitTarget ?: 500.0).asField()) }
    var saved by remember { mutableStateOf(false) }
    var confirmWipe by remember { mutableStateOf(false) }

    // Si el chat o Health Connect cambian el peso, el campo lo refleja.
    LaunchedEffect(user.weightKg) { weight = user.weightKg.asField() }

    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Ajustes", style = MaterialTheme.typography.titleLarge)

        Text("Tu contexto", style = MaterialTheme.typography.titleMedium)
        NumberField("Peso", weight, { weight = it; saved = false }, Modifier.fillMaxWidth(), suffix = "kg")
        NumberField("Proteína mínima por kg", proteinPerKg, { proteinPerKg = it; saved = false }, Modifier.fillMaxWidth(), suffix = "g/kg")
        val minimum = weight.toNumberOrNull()?.let { w -> proteinPerKg.toNumberOrNull()?.let { w * it } }
        minimum?.let {
            Text(
                "Mínimo de proteína: ${formatNumber(it, 0)} g al día.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Objetivo de déficit diario", style = MaterialTheme.typography.bodyLarge)
                Text(
                    "Apagado, el balance solo muestra gasto, comido y déficit.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Switch(checked = useTarget, onCheckedChange = { useTarget = it; saved = false })
        }
        if (useTarget) NumberField("Déficit objetivo", target, { target = it; saved = false }, Modifier.fillMaxWidth(), suffix = "kcal")

        Button(
            onClick = {
                scope.launch {
                    app.store.update { s ->
                        s.copy(
                            user = s.user.copy(
                                weightKg = weight.toNumberOrNull(),
                                proteinPerKg = proteinPerKg.toNumberOrNull() ?: s.user.proteinPerKg,
                                dailyDeficitTarget = if (useTarget) target.toNumberOrNull() else null,
                            ),
                        )
                    }
                    saved = true
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text(if (saved) "Guardado" else "Guardar") }

        Text("Datos", style = MaterialTheme.typography.titleMedium)
        Text(
            "Tu registro se guarda en este móvil. Las etiquetas y los códigos de barras se leen en el dispositivo. " +
                "Si el modelo del móvil no basta, el mensaje (y la foto, si no se pudo leer) va a Gemini en la nube, y " +
                "las búsquedas de productos, a Open Food Facts (datos con licencia ODbL).",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(
            onClick = {
                if (confirmWipe) {
                    scope.launch { app.store.update { StoreState(user = it.user) } }
                    confirmWipe = false
                } else {
                    confirmWipe = true
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(
                if (confirmWipe) "Pulsa otra vez para borrar registro, catálogo, pesos y gasto" else "Borrar todos mis datos",
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}
