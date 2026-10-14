package app.macrai.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Identidad "Libreta": papel cálido, tinta casi negra y un único acento caqui (persimmon).
// La app es una libreta que calcula, no un gimnasio: nada de degradados, confeti ni verdes
// de "bien hecho". La profundidad sale de saltos de superficie y líneas finas.
//
// Regla del acento: siempre relleno con tinta encima (contraste ~7:1), nunca texto caqui
// sobre papel.

private val Paper = Color(0xFFF5F2EB)
private val PaperRaised = Color(0xFFFFFDF8)
private val PaperSunken = Color(0xFFECE8DE)
private val Ink = Color(0xFF16181B)
private val InkMuted = Color(0xFF62666D)
private val Hairline = Color(0xFFDDD8CC)
private val Persimmon = Color(0xFFFF6A3D)

private val Night = Color(0xFF111214)
private val NightRaised = Color(0xFF1A1C1F)
private val NightSunken = Color(0xFF0B0C0D)
private val Chalk = Color(0xFFF1EEE6)
private val ChalkMuted = Color(0xFFA2A5AB)
private val NightHairline = Color(0xFF2A2D31)

/** Colores de macros: mismos tonos en los dos temas, más claros sobre fondo oscuro. */
@Immutable
data class MacroColors(val protein: Color, val carbs: Color, val fat: Color, val estimate: Color)

private val LightMacros = MacroColors(
    protein = Color(0xFF2F5FD0),
    carbs = Color(0xFFB7791F),
    fat = Color(0xFF8A4FD3),
    estimate = Color(0xFF8A8D93),
)
private val DarkMacros = MacroColors(
    protein = Color(0xFF8FB0FF),
    carbs = Color(0xFFF2C05C),
    fat = Color(0xFFC9A4FF),
    estimate = Color(0xFF7D8086),
)

val LocalMacroColors = staticCompositionLocalOf { LightMacros }

private val LightScheme = lightColorScheme(
    primary = Persimmon,
    onPrimary = Ink,
    secondary = Ink,
    onSecondary = Paper,
    background = Paper,
    onBackground = Ink,
    surface = PaperRaised,
    onSurface = Ink,
    surfaceVariant = PaperSunken,
    onSurfaceVariant = InkMuted,
    surfaceContainer = PaperSunken,
    outline = Hairline,
    outlineVariant = Hairline,
)

private val DarkScheme = darkColorScheme(
    primary = Persimmon,
    onPrimary = Ink,
    secondary = Chalk,
    onSecondary = Night,
    background = Night,
    onBackground = Chalk,
    surface = NightRaised,
    onSurface = Chalk,
    surfaceVariant = NightSunken,
    onSurfaceVariant = ChalkMuted,
    surfaceContainer = NightSunken,
    outline = NightHairline,
    outlineVariant = NightHairline,
)

// Las cifras son el producto: siempre con números tabulares para que las columnas cuadren.
private val Figures = "tnum"

private val AppTypography = Typography(
    displaySmall = TextStyle(fontWeight = FontWeight.Bold, fontSize = 34.sp, letterSpacing = (-0.5).sp, fontFeatureSettings = Figures),
    titleLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 20.sp, letterSpacing = (-0.2).sp),
    titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 16.sp),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 23.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    labelLarge = TextStyle(fontWeight = FontWeight.Medium, fontSize = 14.sp, fontFeatureSettings = Figures),
    labelMedium = TextStyle(fontWeight = FontWeight.Medium, fontSize = 12.sp, fontFeatureSettings = Figures),
    labelSmall = TextStyle(fontWeight = FontWeight.Medium, fontSize = 11.sp, letterSpacing = 0.4.sp, fontFeatureSettings = Figures),
)

/** Estilo de las cifras en tablas: tabulares y un punto más densas que el texto. */
val FigureStyle = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Medium, fontFeatureSettings = Figures)

@Composable
fun MacrAITheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalMacroColors provides if (dark) DarkMacros else LightMacros) {
        MaterialTheme(
            colorScheme = if (dark) DarkScheme else LightScheme,
            typography = AppTypography,
            content = content,
        )
    }
}
