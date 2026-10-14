package app.macrai.android.ai

import android.graphics.BitmapFactory
import android.util.Log
import app.macrai.core.LanguageModel
import app.macrai.core.ModelRequest
import app.macrai.core.ModelTier
import com.google.firebase.Firebase
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.generationConfig

// Gemini Nano en el dispositivo con Gemini en la nube de respaldo, vía Firebase AI Logic.
//
// - Extracción (mensajes cortos): PREFER_ON_DEVICE. En móviles con AICore (Pixel 9/10,
//   Galaxy S25/S26 y otros recientes) corre gratis, sin red y sin coste; en el resto,
//   Firebase manda la misma petición a la nube.
// - Dictados largos, fotos sin OCR y análisis: solo nube, porque el modelo local tiene
//   ventana corta, una sola imagen y salida limitada.
//
// La API híbrida es experimental (abril de 2026) y va detrás de @PublicPreviewAPI: sus
// nombres pueden moverse entre versiones beta. Toda la dependencia queda en este archivo.

private const val TAG = "MacrAI-IA"

/** Modelos de la nube (Gemini Developer API). Si Firebase responde "model not found", se cambian aquí. */
private const val EXTRACTION_MODEL = "gemini-3.5-flash-lite"
private const val REASONING_MODEL = "gemini-3.6-flash"

@OptIn(PublicPreviewAPI::class)
class HybridLanguageModel : LanguageModel {
    // Perezoso: sin google-services.json no hay FirebaseApp y crearlo aquí cerraría la app.
    private val ai by lazy { Firebase.ai(backend = GenerativeBackend.googleAI()) }

    private val onDeviceFirst by lazy {
        // Sin límite de salida propio: el del modelo local es más corto y lo fija AICore.
        ai.generativeModel(
            modelName = EXTRACTION_MODEL,
            generationConfig = generationConfig { temperature = 0.1f },
            onDeviceConfig = OnDeviceConfig(mode = InferenceMode.PREFER_ON_DEVICE),
        )
    }

    private val cloudExtraction by lazy {
        ai.generativeModel(
            modelName = EXTRACTION_MODEL,
            generationConfig = generationConfig {
                temperature = 0.1f
                // Un dictado de un día entero cabe de sobra.
                maxOutputTokens = 2048
            },
        )
    }

    override suspend fun generate(request: ModelRequest): String {
        val system = request.system
        val model = when {
            system != null -> ai.generativeModel(
                modelName = REASONING_MODEL,
                generationConfig = generationConfig { temperature = 0.3f },
                systemInstruction = content { text(system) },
            )
            request.tier == ModelTier.ON_DEVICE_PREFERRED -> onDeviceFirst
            else -> cloudExtraction
        }
        val prompt = content {
            request.image?.let { bytes -> BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.let { image(it) } }
            text(request.prompt)
        }
        // El motor convierte cualquier fallo en "no he podido interpretarlo"; aquí queda la causa.
        return try {
            model.generateContent(prompt).text.orEmpty()
        } catch (e: Exception) {
            Log.e(TAG, "Fallo del modelo (${request.tier}, sistema=${system != null})", e)
            throw e
        }
    }
}
