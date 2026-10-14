package app.macrai.android.input

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

// OCR de etiquetas y capturas del reloj, y lectura del código de barras, en el dispositivo
// (ML Kit). Funciona en cualquier Android, sin red y gratis: el modelo solo recibe texto, que
// cabe en la ventana de Gemini Nano mucho mejor que una imagen, y el EAN identifica el
// producto en Open Food Facts sin depender del nombre.

private const val MAX_SIDE_PX = 1600

data class Photo(val bitmap: Bitmap, val jpeg: ByteArray, val text: String, val barcode: String?)

class LabelOcr(private val context: Context) {
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private val barcodes = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E)
            .build(),
    )

    suspend fun read(uri: Uri): Photo? = withContext(Dispatchers.IO) {
        val bitmap = decodeScaled(uri) ?: return@withContext null
        val image = InputImage.fromBitmap(bitmap, 0)
        val text = recognizer.process(image).await().text
        val barcode = runCatching { barcodes.process(image).await().firstNotNullOfOrNull { it.rawValue } }.getOrNull()
        val jpeg = ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 85, out)
            out.toByteArray()
        }
        Photo(bitmap, jpeg, text, barcode)
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
