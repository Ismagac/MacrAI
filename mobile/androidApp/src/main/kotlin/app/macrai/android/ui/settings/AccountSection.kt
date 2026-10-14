package app.macrai.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.macrai.android.MacrAIApplication
import app.macrai.android.data.SyncStatus
import kotlinx.coroutines.launch
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter

// Cuenta: entrar o crear una con email y contraseña, sincronizar y borrarla. Con cuenta, el
// registro, el catálogo, los alias, el peso, el gasto y los ajustes se copian en Supabase y
// llegan a cualquier móvil (y a la web) con la misma cuenta.

private val HOUR = DateTimeFormatter.ofPattern("d MMM, HH:mm")

@Composable
fun AccountSection(app: MacrAIApplication) {
    val status by app.sync.status.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Cuenta", style = MaterialTheme.typography.titleMedium)

        when (val s = status) {
            SyncStatus.NotConfigured -> Text(
                "Esta build no lleva la configuración de Supabase: el registro se queda en el móvil. " +
                    "Para activar las cuentas, añade MACRAI_SUPABASE_URL y MACRAI_SUPABASE_ANON_KEY a mobile/local.properties.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            SyncStatus.SignedOut -> {
                Text(
                    "Con una cuenta, tu registro, catálogo, alias, peso y ajustes se guardan en la nube y llegan a cualquier móvil. " +
                        "Lo que ya tengas en este móvil se sube al entrar.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    email, { email = it }, Modifier.fillMaxWidth(),
                    label = { Text("Email") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                )
                OutlinedTextField(
                    password, { password = it }, Modifier.fillMaxWidth(),
                    label = { Text("Contraseña (mínimo 6 caracteres)") }, singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        enabled = !busy && email.isNotBlank() && password.length >= 6,
                        onClick = {
                            busy = true
                            scope.launch {
                                message = app.sync.signIn(email, password).exceptionOrNull()?.let { "No se pudo entrar: ${it.message}" }
                                busy = false
                            }
                        },
                        modifier = Modifier.weight(1f),
                    ) { Text("Entrar") }
                    OutlinedButton(
                        enabled = !busy && email.isNotBlank() && password.length >= 6,
                        onClick = {
                            busy = true
                            scope.launch {
                                message = app.sync.signUp(email, password).fold(
                                    onSuccess = { signedIn ->
                                        if (signedIn) null
                                        else "Te hemos enviado un email. Abre el enlace para confirmar la cuenta y después pulsa «Entrar»."
                                    },
                                    onFailure = { "No se pudo crear la cuenta: ${it.message}" },
                                )
                                busy = false
                            }
                        },
                        modifier = Modifier.weight(1f),
                    ) { Text("Crear cuenta") }
                }
            }

            else -> {
                Text(app.sync.session?.email ?: "Sesión iniciada", style = MaterialTheme.typography.bodyLarge)
                Text(
                    when (s) {
                        SyncStatus.Syncing -> "Sincronizando…"
                        is SyncStatus.Failed -> "Última sincronización fallida: ${s.message}. Se reintentará sola."
                        is SyncStatus.Synced -> s.at?.let { "Sincronizado el ${OffsetDateTime.parse(it).format(HOUR)}." } ?: "Pendiente de sincronizar."
                        else -> ""
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (s is SyncStatus.Failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        enabled = s != SyncStatus.Syncing,
                        onClick = { scope.launch { app.sync.syncNow() } },
                        modifier = Modifier.weight(1f),
                    ) { Text("Sincronizar ahora") }
                    OutlinedButton(onClick = { scope.launch { app.sync.signOut() } }, modifier = Modifier.weight(1f)) { Text("Cerrar sesión") }
                }
                TextButton(
                    onClick = {
                        if (!confirmDelete) {
                            confirmDelete = true
                        } else {
                            scope.launch {
                                message = app.sync.deleteAccount().exceptionOrNull()?.let { "No se pudo borrar la cuenta: ${it.message}" }
                                confirmDelete = false
                            }
                        }
                    },
                ) {
                    Text(
                        if (confirmDelete) "Pulsa otra vez: se borran la cuenta y todos sus datos, también en la nube" else "Borrar mi cuenta",
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
        message?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error) }
    }
}
