package app.macrai.android.data

import android.content.Context
import app.macrai.core.Session
import app.macrai.core.SessionStore
import kotlinx.serialization.json.Json

/** Sesión de Supabase en las preferencias privadas de la app (no salen del móvil ni de la copia de seguridad). */
class PrefsSessionStore(context: Context) : SessionStore {
    private val prefs = context.getSharedPreferences("sesion", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    override fun load(): Session? =
        prefs.getString(KEY, null)?.let { runCatching { json.decodeFromString(Session.serializer(), it) }.getOrNull() }

    override fun save(session: Session?) {
        prefs.edit().apply {
            if (session == null) remove(KEY) else putString(KEY, json.encodeToString(Session.serializer(), session))
        }.apply()
    }

    private companion object {
        const val KEY = "supabase"
    }
}
