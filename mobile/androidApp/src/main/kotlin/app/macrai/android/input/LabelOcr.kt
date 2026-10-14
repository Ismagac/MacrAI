package app.macrai.android.input

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

// OCR de etiquetas y capturas del reloj en el dispositivo (ML Kit Text Recognition v2).
// Funciona en cualquier Android, sin red y gratis: el modelo solo recibe texto, que cabe en
// la ventana de Gemini Nano mucho mejor que una imagen.

private const val MAX_SIDE_PX = 1600

data class Photo(val bitmap: Bitmap, val jpeg: ByteArray, val text: String)

class LabelOcr(private val context: Context) {
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    suspend fun read(uri: Uri): Photo? = withContext(Dispatchers.IO) {
        val bitmap = decodeScaled(uri) ?: return@withContext null
        val text = recognizer.process(InputImage.fromBitmap(bitmap, 0)).await().text
        val jpeg = ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
            out.toByteArray()
        }
        Photo(bitmap, jpeg, text)
    }

    private fun decodeScaled(uri: Uri): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > MAX_SIDE_PX) sample *= 2
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        return context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
    }
}
