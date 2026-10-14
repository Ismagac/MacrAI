package app.macrai.android.ui.chat

import android.graphics.Bitmap
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.macrai.android.input.Photo
import app.macrai.core.AssistantReply
import app.macrai.core.ReplyBlock
import app.macrai.core.MacroAssistant
import app.macrai.core.UserMessage
import kotlinx.coroutines.launch
import kotlinx.datetime.toKotlinLocalDateTime
import java.time.LocalDateTime

sealed interface ChatItem {
    data class User(val text: String, val photo: Bitmap?) : ChatItem
    data class Assistant(val reply: AssistantReply) : ChatItem
}

class ChatViewModel(
    private val assistant: MacroAssistant,
    private val aiConfigured: () -> Boolean,
) : ViewModel() {
    val items = mutableStateListOf<ChatItem>()
    var busy by mutableStateOf(false)
        private set

    fun send(text: String, photo: Photo? = null) {
        val trimmed = text.trim()
        if (trimmed.isEmpty() && photo == null) return
        items += ChatItem.User(trimmed, photo?.bitmap)
        busy = true
        viewModelScope.launch {
            try {
                items += ChatItem.Assistant(reply(trimmed, photo))
            } finally {
                busy = false
            }
        }
    }

    private suspend fun reply(trimmed: String, photo: Photo?): AssistantReply {
        if (!aiConfigured()) return NOT_CONFIGURED
        return assistant.handle(
            UserMessage(
                // Una foto sin texto también es un mensaje: "estos son los macros".
                text = trimmed.ifEmpty { "Te paso esta foto." },
                at = LocalDateTime.now().toKotlinLocalDateTime(),
                ocrText = photo?.text,
                image = photo?.jpeg,
                barcode = photo?.barcode,
            ),
        )
    }
}

private val NOT_CONFIGURED = AssistantReply(
    listOf(
        ReplyBlock.Title("Falta conectar la IA"),
        ReplyBlock.Text(
            "Esta build no incluye google-services.json, así que no puedo interpretar mensajes. " +
                "Añádelo en mobile/androidApp/ (pasos en mobile/README.md) y vuelve a instalar.",
        ),
    ),
)
