package app.macrai.android.ai

import android.graphics.BitmapFactory
import app.macrai.core.LanguageModel
import app.macrai.core.ModelRequest
import app.macrai.core.ModelTier
import com.google.firebase.Firebase
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.GenerativeBackend
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
// La API híbrida es experimental (abril de 2026): los nombres de OnDeviceConfig e
// InferenceMode siguen la referencia de Firebase y pueden moverse entre versiones beta.
// Toda la dependencia queda en este archivo.

/** Modelos de la nube (Gemini Developer API, con capa gratuita). */
private const val EXTRACTION_MODEL = "gemini-3.1-flash-lite"
private const val REASONING_MODEL = "gemini-3.5-flash"

class HybridLanguageModel : LanguageModel {
    private val ai = Firebase.ai(backend = GenerativeBackend.googleAI())

    private val extractionConfig = generationConfig {
        temperature = 0.1f
        // El JSON de un mensaje normal cabe de sobra; un dictado va a la nube.
        maxOutputTokens = 800
    }

    private val onDeviceFirst = ai.generativeModel(
        modelName = EXTRACTION_MODEL,
        generationConfig = extractionConfig,
        onDeviceConfig = OnDeviceConfig(mode = InferenceMode.PREFER_ON_DEVICE),
    )

    private val cloudExtraction = ai.generativeModel(
        modelName = EXTRACTION_MODEL,
        generationConfig = extractionConfig,
    )

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
        return model.generateContent(prompt).text.orEmpty()
    }
}
