package app.macrai.android.data

import app.macrai.core.MacroStore
import app.macrai.core.StoreState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.io.File

// Fase 1: el registro vive en el móvil, en un único JSON. Funciona sin red y es suficiente
// para validar el flujo. La fase 2 lo sustituye por Room + sincronización con Supabase sin
// tocar el motor, que solo ve MacroStore.

class FileMacroStore(private val file: File) : MacroStore {
    private val json = Json { ignoreUnknownKeys = true }
    private val mutex = Mutex()
    private val _state = MutableStateFlow(load())

    /** Para que las pantallas se repinten cuando el chat cambia algo. */
    val flow: StateFlow<StoreState> = _state

    private fun load(): StoreState =
        runCatching { json.decodeFromString(StoreState.serializer(), file.readText()) }.getOrDefault(StoreState())

    override suspend fun state(): StoreState = _state.value

    override suspend fun update(transform: (StoreState) -> StoreState): StoreState = mutex.withLock {
        val next = transform(_state.value)
        withContext(Dispatchers.IO) {
            val tmp = File(file.parentFile, "${file.name}.tmp")
            tmp.writeText(json.encodeToString(StoreState.serializer(), next))
            tmp.renameTo(file)
        }
        _state.value = next
        next
    }
}
