package app.macrai.android

import android.app.Application
import app.macrai.android.ai.HybridLanguageModel
import app.macrai.android.data.FileMacroStore
import app.macrai.android.health.HealthConnectSource
import app.macrai.core.MacroAssistant
import com.google.firebase.FirebaseApp
import java.io.File

/** Grafo de dependencias de la fase 1: pocas piezas, sin framework de inyección. */
class MacrAIApplication : Application() {
    val store by lazy { FileMacroStore(File(filesDir, "registro.json")) }
    val health by lazy { HealthConnectSource(this) }

    /** Firebase se inicializa solo si la build incluyó google-services.json. */
    val aiConfigured: Boolean get() = FirebaseApp.getApps(this).isNotEmpty()
    val assistant by lazy {
        MacroAssistant(
            store = store,
            model = HybridLanguageModel(),
            behaviorDoc = assets.open("comportamiento-chat-macros.md").bufferedReader().use { it.readText() },
        )
    }
}
