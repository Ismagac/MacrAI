package app.macrai.core

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.datetime.LocalDate
import kotlinx.serialization.Serializable

// Persistencia del registro. La app guarda localmente (offline-first) y sincroniza con
// Supabase; el motor solo ve esta interfaz.

interface MacroStore {
    suspend fun state(): StoreState
    suspend fun update(transform: (StoreState) -> StoreState): StoreState
}

@Serializable
data class PendingQuestion(val key: String, val text: String, val day: LocalDate, val reminded: Boolean = false)

@Serializable
data class StoreState(
    val entries: List<LogEntry> = emptyList(),
    val catalog: List<FoodProfile> = emptyList(),
    val weighIns: List<WeighIn> = emptyList(),
    val expenditures: List<Expenditure> = emptyList(),
    val user: UserContext = UserContext(),
    /** Día de registro abierto; null antes del primer registro. */
    val openDay: LocalDate? = null,
    val closedDays: Set<LocalDate> = emptySet(),
    /** Datos pendientes: se preguntan una vez y se recuerdan una sola vez más al cerrar (§13). */
    val pending: List<PendingQuestion> = emptyList(),
    /** Avisos que se dan una sola vez: errores de voz (§16.3), valores raros (regla 8). */
    val notedOnce: Set<String> = emptySet(),
    val nextId: Long = 1,
) {
    fun entriesOf(day: LocalDate): List<LogEntry> = entries.filter { it.day == day }

    val lastEntry: LogEntry? get() = entries.maxByOrNull { it.loggedAt }

    fun food(id: String?): FoodProfile? = id?.let { catalog.firstOrNull { f -> f.id == it } }
}

class InMemoryMacroStore(initial: StoreState = StoreState()) : MacroStore {
    private val mutex = Mutex()
    private var current = initial

    override suspend fun state(): StoreState = mutex.withLock { current }

    override suspend fun update(transform: (StoreState) -> StoreState): StoreState =
        mutex.withLock { transform(current).also { current = it } }
}
