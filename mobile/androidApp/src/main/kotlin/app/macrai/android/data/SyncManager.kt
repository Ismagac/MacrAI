package app.macrai.android.data

import app.macrai.core.Session
import app.macrai.core.SignUpResult
import app.macrai.core.StoreState
import app.macrai.core.SupabaseClient
import app.macrai.core.SyncEngine
import app.macrai.core.SyncMeta
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

// Cuenta y sincronización en segundo plano: tras cada cambio del registro (con unos segundos
// de margen para agrupar), al abrir la app y cuando el usuario lo pide. Sin red no pasa nada:
// el móvil sigue funcionando y se reintenta en la siguiente ocasión.

sealed interface SyncStatus {
    data object NotConfigured : SyncStatus
    data object SignedOut : SyncStatus
    data object Syncing : SyncStatus
    data class Synced(val at: String?) : SyncStatus
    data class Failed(val message: String) : SyncStatus
}

private const val DEBOUNCE_MS = 4_000L

class SyncManager(
    private val client: SupabaseClient?,
    private val store: FileMacroStore,
    private val scope: CoroutineScope,
) {
    private val engine = client?.let { SyncEngine(it) }
    private val mutex = Mutex()
    private val _status = MutableStateFlow(initialStatus())
    val status: StateFlow<SyncStatus> = _status

    val session: Session? get() = client?.session

    private fun initialStatus(): SyncStatus = when {
        client == null -> SyncStatus.NotConfigured
        client.session == null -> SyncStatus.SignedOut
        else -> SyncStatus.Synced(store.flow.value.sync.lastSyncAt)
    }

    @OptIn(FlowPreview::class)
    fun start() {
        if (engine == null) return
        scope.launch {
            // Solo los cambios del registro disparan una sincronización, no los de la propia sincronización.
            store.flow
                .map { it.copy(sync = SyncMeta()) }
                .distinctUntilChanged()
                .drop(1)
                .debounce(DEBOUNCE_MS)
                .collect { if (client?.session != null) syncNow() }
        }
        requestSync()
    }

    fun requestSync() {
        if (client?.session != null) scope.launch { syncNow() }
    }

    suspend fun syncNow(): Boolean {
        val engine = engine ?: return false
        return mutex.withLock {
            _status.value = SyncStatus.Syncing
            runCatching { engine.sync(store) }
                .onSuccess { _status.value = SyncStatus.Synced(store.flow.value.sync.lastSyncAt) }
                .onFailure {
                    _status.value = if (client?.session == null) SyncStatus.SignedOut else SyncStatus.Failed(it.message ?: "Error al sincronizar")
                }
                .isSuccess
        }
    }

    suspend fun signIn(email: String, password: String): Result<Unit> = runCatching {
        requireNotNull(client).signIn(email.trim(), password)
        syncNow()
        Unit
    }

    /** true si ya hay sesión; false si hay que confirmar el email antes de entrar. */
    suspend fun signUp(email: String, password: String): Result<Boolean> = runCatching {
        when (requireNotNull(client).signUp(email.trim(), password)) {
            is SignUpResult.SignedIn -> {
                syncNow()
                true
            }
            SignUpResult.ConfirmEmail -> false
        }
    }

    suspend fun signOut() {
        client?.signOut()
        _status.value = SyncStatus.SignedOut
    }

    /** Borra la cuenta en el servidor y los datos de este móvil. */
    suspend fun deleteAccount(): Result<Unit> = runCatching {
        requireNotNull(client).deleteAccount()
        store.update { StoreState() }
        _status.value = SyncStatus.SignedOut
    }
}
