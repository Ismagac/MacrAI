package app.macrai.android

import android.app.Application
import app.macrai.android.ai.HybridLanguageModel
import app.macrai.android.data.AndroidHttp
import app.macrai.android.data.FileMacroStore
import app.macrai.android.data.PrefsSessionStore
import app.macrai.android.data.SyncManager
import app.macrai.android.health.HealthConnectSource
import app.macrai.core.ChainedFoodDatabase
import app.macrai.core.GlobalCatalog
import app.macrai.core.MacroAssistant
import app.macrai.core.OpenFoodFacts
import app.macrai.core.SupabaseClient
import app.macrai.core.SupabaseConfig
import com.google.firebase.FirebaseApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import java.io.File

/** Grafo de dependencias: pocas piezas, sin framework de inyección. */
class MacrAIApplication : Application() {
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val http by lazy { AndroidHttp() }

    val store by lazy { FileMacroStore(File(filesDir, "registro.json")) }
    val health by lazy { HealthConnectSource(this) }

    /** Null si la build no lleva la URL y la clave de Supabase: entonces todo queda en el móvil. */
    val supabase: SupabaseClient? by lazy {
        val url = BuildConfig.SUPABASE_URL
        val key = BuildConfig.SUPABASE_ANON_KEY
        if (url.isBlank() || key.isBlank()) null
        else SupabaseClient(SupabaseConfig(url, key), http, PrefsSessionStore(this))
    }

    val sync by lazy { SyncManager(supabase, store, appScope) }

    /** Primero el catálogo de MacrAI (supermercados españoles y etiquetas de usuarios), luego Open Food Facts. */
    val foods by lazy {
        ChainedFoodDatabase(listOfNotNull(supabase?.let { GlobalCatalog(it) }, OpenFoodFacts(http)))
    }

    /** Firebase se inicializa solo si la build incluyó google-services.json. */
    val aiConfigured: Boolean get() = FirebaseApp.getApps(this).isNotEmpty()

    val assistant by lazy {
        MacroAssistant(
            store = store,
            model = HybridLanguageModel(),
            behaviorDoc = assets.open("comportamiento-chat-macros.md").bufferedReader().use { it.readText() },
            foods = foods,
        )
    }

    override fun onCreate() {
        super.onCreate()
        sync.start()
    }
}
