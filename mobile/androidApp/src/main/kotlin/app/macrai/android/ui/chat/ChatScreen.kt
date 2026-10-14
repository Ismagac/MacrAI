package app.macrai.android.ui.chat

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import app.macrai.android.MacrAIApplication
import app.macrai.android.input.LabelOcr
import app.macrai.android.input.Photo
import app.macrai.android.input.SpeechInput
import app.macrai.android.ui.theme.FigureStyle
import app.macrai.android.ui.theme.LocalMacroColors
import app.macrai.core.Meal
import app.macrai.core.StoreState
import app.macrai.core.dayLabel
import app.macrai.core.formatNumber
import app.macrai.core.sum
import kotlinx.coroutines.launch
import java.io.File

// "Hoy": la libreta. Arriba, el día abierto siempre a la vista (el usuario pidió el
// acumulado del día en cada respuesta, aquí además vive fijo). En medio, la conversación.
// Abajo, el compositor: la voz es el canal principal, así que el micrófono manda.

private val EXAMPLES = listOf(
    "Añade 150 de leche desnatada a la merienda",
    "Apunta 91,7 para el peso",
    "¿Tienes los macros de la sopa de cebolla?",
)

@Composable
fun ChatScreen(app: MacrAIApplication, modifier: Modifier = Modifier) {
    val vm = viewModel { ChatViewModel(app.assistant) { app.aiConfigured } }
    val state by app.store.flow.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    var openMeal by remember { mutableStateOf<Meal?>(null) }

    LaunchedEffect(vm.items.size) {
        if (vm.items.isNotEmpty()) listState.animateScrollToItem(vm.items.lastIndex)
    }

    Column(modifier.fillMaxSize().imePadding()) {
        DayStrip(state, onMeal = { openMeal = it })
        if (vm.busy) LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp))

        Box(Modifier.weight(1f)) {
            if (vm.items.isEmpty()) {
                EmptyState(onExample = { vm.send(it) })
            } else {
                LazyColumn(
                    state = listState,
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(vm.items) { item ->
                        when (item) {
                            is ChatItem.User -> UserBubble(item)
                            is ChatItem.Assistant -> ReplyCard(item.reply)
                        }
                    }
                }
            }
        }
        Composer(onSend = vm::send, enabled = !vm.busy)
    }
    openMeal?.let { MealSheet(app, state, it, onDismiss = { openMeal = null }) }
}

/** Día de registro, kcal y proteína frente al mínimo, y las cinco comidas. */
@Composable
private fun DayStrip(state: StoreState, onMeal: (Meal) -> Unit) {
    val day = state.openDay
    val entries = day?.let { state.entriesOf(it) }.orEmpty()
    val total = entries.map { it.macros }.sum()
    val proteinMin = state.user.proteinMinimum
    val colors = LocalMacroColors.current

    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                Text(
                    day?.let { dayLabel(it).replaceFirstChar { c -> c.uppercase() } + if (it in state.closedDays) " · cerrado" else " · abierto" } ?: "Sin registros",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text("${formatNumber(total.kcal, 0)} kcal", style = MaterialTheme.typography.displaySmall)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("Proteína", style = MaterialTheme.typography.labelMedium, color = colors.protein)
                Text(
                    "${formatNumber(total.protein, 0)}${proteinMin?.let { " / ${formatNumber(it, 0)}" } ?: ""} g",
                    style = MaterialTheme.typography.titleLarge.merge(FigureStyle),
                )
            }
        }
        proteinMin?.let {
            LinearProgressIndicator(
                progress = { (total.protein / it).toFloat().coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp).height(4.dp),
                color = colors.protein,
                trackColor = MaterialTheme.colorScheme.surfaceVariant,
            )
        }
        Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Meal.entries.forEach { meal ->
                val kcal = entries.filter { it.meal == meal }.sumOf { it.macros.kcal }
                MealChip(meal.label.substringBefore(' '), kcal, Modifier.weight(1f), enabled = state.openDay != null) { onMeal(meal) }
            }
        }
    }
}

@Composable
private fun MealChip(label: String, kcal: Double, modifier: Modifier, enabled: Boolean, onClick: () -> Unit) {
    val filled = kcal > 0
    Column(
        modifier
            .clip(RoundedCornerShape(10.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .background(if (filled) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(10.dp))
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(10.dp))
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        Text(if (filled) formatNumber(kcal, 0) else "-", style = FigureStyle)
    }
}

@Composable
private fun EmptyState(onExample: (String) -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Dime qué has comido.", style = MaterialTheme.typography.titleLarge)
        Text(
            "Por voz, texto o con la foto de la etiqueta. Lo registro, te digo qué he supuesto y llevo la cuenta del día.",
            Modifier.padding(top = 6.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(16.dp))
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(EXAMPLES) { SuggestionChip(onClick = { onExample(it) }, label = { Text(it) }) }
        }
    }
}

@Composable
private fun UserBubble(item: ChatItem.User) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Column(
            Modifier
                .widthIn(max = 300.dp)
                .background(MaterialTheme.colorScheme.secondary, RoundedCornerShape(16.dp, 16.dp, 4.dp, 16.dp))
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item.photo?.let {
                Image(
                    it.asImageBitmap(),
                    contentDescription = "Foto adjunta",
                    Modifier.size(160.dp).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(10.dp)),
                    contentScale = ContentScale.Crop,
                )
            }
            if (item.text.isNotEmpty()) Text(item.text, color = MaterialTheme.colorScheme.onSecondary)
        }
    }
}

@Composable
private fun Composer(onSend: (String, Photo?) -> Unit, enabled: Boolean) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val ocr = remember { LabelOcr(context) }
    val speech = remember { SpeechInput(context) }
    DisposableEffect(Unit) { onDispose { speech.release() } }

    var text by remember { mutableStateOf("") }
    var listening by remember { mutableStateOf(false) }
    var photo by remember { mutableStateOf<Photo?>(null) }
    var menu by remember { mutableStateOf(false) }
    var pendingCapture by remember { mutableStateOf<Uri?>(null) }

    fun attach(uri: Uri?) {
        if (uri == null) return
        scope.launch { photo = ocr.read(uri) }
    }

    val takePicture = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        if (ok) attach(pendingCapture)
    }
    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { attach(it) }

    fun listen() {
        listening = true
        speech.start(
            onPartial = { text = it },
            onResult = { listening = false; text = it },
            onFailure = { listening = false },
        )
    }
    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) listen()
    }

    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background).padding(12.dp)) {
        photo?.let { p ->
            Row(Modifier.padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Image(p.bitmap.asImageBitmap(), null, Modifier.size(44.dp), contentScale = ContentScale.Crop)
                Text(
                    when {
                        p.barcode != null -> "Código de barras ${p.barcode}"
                        p.text.isNotBlank() -> "Etiqueta leída en el móvil"
                        else -> "Foto adjunta"
                    },
                    Modifier.padding(start = 10.dp).weight(1f),
                    style = MaterialTheme.typography.bodyMedium,
                )
                IconButton(onClick = { photo = null }) { Icon(Icons.Outlined.Close, "Quitar foto") }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box {
                IconButton(onClick = { menu = true }, enabled = enabled) { Icon(Icons.Outlined.CameraAlt, "Foto") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text("Foto de la etiqueta o del código de barras") },
                        leadingIcon = { Icon(Icons.Outlined.CameraAlt, null) },
                        onClick = {
                            menu = false
                            val file = File(context.cacheDir, "photos/${System.currentTimeMillis()}.jpg").apply { parentFile?.mkdirs() }
                            val uri = FileProvider.getUriForFile(context, "${context.packageName}.photos", file)
                            pendingCapture = uri
                            takePicture.launch(uri)
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("Captura del reloj o galería") },
                        leadingIcon = { Icon(Icons.Outlined.Image, null) },
                        onClick = {
                            menu = false
                            pickImage.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        },
                    )
                }
            }
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text(if (listening) "Te escucho…" else "Añade 150 de leche a la merienda") },
                shape = RoundedCornerShape(24.dp),
                maxLines = 5,
                colors = OutlinedTextFieldDefaults.colors(unfocusedBorderColor = MaterialTheme.colorScheme.outline),
            )
            Spacer(Modifier.size(8.dp))
            val canSend = text.isNotBlank() || photo != null
            FilledIconButton(
                onClick = {
                    when {
                        listening -> { speech.stop(); listening = false }
                        canSend -> { onSend(text, photo); text = ""; photo = null }
                        ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED -> listen()
                        else -> micPermission.launch(Manifest.permission.RECORD_AUDIO)
                    }
                },
                enabled = enabled && (canSend || speech.available || listening),
                modifier = Modifier.size(52.dp),
                shape = CircleShape,
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = MaterialTheme.colorScheme.primary),
            ) {
                Icon(
                    when {
                        listening -> Icons.Outlined.Stop
                        canSend -> Icons.AutoMirrored.Filled.Send
                        else -> Icons.Outlined.Mic
                    },
                    contentDescription = if (canSend) "Enviar" else "Dictar",
                )
            }
        }
    }
}
