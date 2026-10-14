package app.macrai.android.input

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

// Dictado con el reconocedor del sistema, en el dispositivo cuando el idioma está descargado.
// La voz es un canal principal y llega sucia: no se corrige aquí, lo interpreta el modelo
// con el catálogo delante (§2.2 del documento de comportamiento).

class SpeechInput(context: Context) {
    private val recognizer = SpeechRecognizer.createSpeechRecognizer(context)

    val available: Boolean = SpeechRecognizer.isRecognitionAvailable(context)

    fun start(onPartial: (String) -> Unit, onResult: (String) -> Unit, onError: () -> Unit) {
        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onPartialResults(partialResults: Bundle) {
                partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let(onPartial)
            }

            override fun onResults(results: Bundle) {
                val text = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (text.isNullOrBlank()) onError() else onResult(text)
            }

            override fun onError(error: Int) = onError()
            override fun onReadyForSpeech(params: Bundle?) = Unit
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit
        })
        recognizer.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-ES")
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                // Los dictados de un día entero son largos: no cortar en la primera pausa.
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
            },
        )
    }

    fun stop() = recognizer.stopListening()

    fun release() = recognizer.destroy()
}
