package com.digicyber.client.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import com.digicyber.client.R

// Estedad draws Persian and Latin alike, so one family serves both languages.
val Estedad = FontFamily(
    Font(R.font.estedad_regular, FontWeight.Normal),
    Font(R.font.estedad_medium, FontWeight.Medium),
    Font(R.font.estedad_bold, FontWeight.Bold),
)

// Digi Cyber's colours, from the logo: midnight blue, and cyan running into violet.
object Palette {
    val cyan = Color(0xFF2FD3FF)
    val blue = Color(0xFF4F7BFF)
    val violet = Color(0xFF9B6BFF)
    val midnight = Color(0xFF070B19)
    val good = Color(0xFF3DDC97)
    val bad = Color(0xFFFF5F7E)
    val warn = Color(0xFFFFB84D)
    val critical = listOf(Color(0xFFE5484D), Color(0xFFC62F3A))
    val warning = listOf(Color(0xFFF7C04A), Color(0xFFEF9F27))

    // The logo's gradient, for the hero when protected, primary buttons and the traffic bar.
    val brand = listOf(Color(0xFF17B8F2), Color(0xFF3F6AF3), Color(0xFF7F52F2))
    fun gradient(): Brush = Brush.linearGradient(brand)
    fun horizontal(): Brush = Brush.horizontalGradient(brand)
}

@Immutable
data class DcColors(
    val dark: Boolean,
    val background: Color,
    val panel: Color,
    val card: Color,
    val cardHigh: Color,
    val line: Color,
    val text: Color,
    val muted: Color,
    val faint: Color,
    val accent: Color,
    val accentSoft: Color,
    val button: Color,
    val onButton: Color,
    val secured: Color,
    val unsecured: Color,
    val unsecuredBadge: Color,
    val securedBadge: Color,
)

val DarkDc = DcColors(
    dark = true,
    background = Color(0xFF070B19),
    panel = Color(0xFF0A1027),
    card = Color(0xFF0F1634),
    cardHigh = Color(0xFF161E42),
    line = Color(0xFF1C2550),
    text = Color(0xFFEDF1FF),
    muted = Color(0xFF8A95C1),
    faint = Color(0xFF5C6693),
    accent = Color(0xFF3FD0FF),
    accentSoft = Color(0x243FD0FF),
    button = Color(0xFF4F7BFF),
    onButton = Color.White,
    secured = Color(0xFF3DDC97),
    unsecured = Color(0xFFFF7A92),
    unsecuredBadge = Color(0x26FF5F7E),
    securedBadge = Color(0x333DDC97),
)

val LightDc = DcColors(
    dark = false,
    background = Color(0xFFF3F5FC),
    panel = Color(0xFFFFFFFF),
    card = Color(0xFFFFFFFF),
    cardHigh = Color(0xFFEEF1FA),
    line = Color(0xFFE2E7F4),
    text = Color(0xFF0E1430),
    muted = Color(0xFF5D668C),
    faint = Color(0xFF8E97BB),
    accent = Color(0xFF1A8FE0),
    accentSoft = Color(0x1C1A8FE0),
    button = Color(0xFF3F63F0),
    onButton = Color.White,
    secured = Color(0xFF11A36B),
    unsecured = Color(0xFFE03A5C),
    unsecuredBadge = Color(0x1AE03A5C),
    securedBadge = Color(0x2211A36B),
)

val LocalDc = staticCompositionLocalOf { DarkDc }

private fun scheme(c: DcColors) = if (c.dark) {
    darkColorScheme(
        primary = c.button, onPrimary = c.onButton, secondary = c.accent, background = c.background, onBackground = c.text,
        surface = c.card, onSurface = c.text, surfaceVariant = c.cardHigh, onSurfaceVariant = c.muted, outline = c.line,
        surfaceContainerLow = c.card, surfaceContainer = c.card, surfaceContainerHigh = c.cardHigh, error = Palette.bad,
    )
} else {
    lightColorScheme(
        primary = c.button, onPrimary = c.onButton, secondary = c.accent, background = c.background, onBackground = c.text,
        surface = c.card, onSurface = c.text, surfaceVariant = c.cardHigh, onSurfaceVariant = c.muted, outline = c.line,
        surfaceContainerLow = c.card, surfaceContainer = c.card, surfaceContainerHigh = c.cardHigh, error = Palette.bad,
    )
}

private fun Typography.inFamily(f: FontFamily) = Typography(
    displayLarge = displayLarge.copy(fontFamily = f),
    displayMedium = displayMedium.copy(fontFamily = f),
    displaySmall = displaySmall.copy(fontFamily = f),
    headlineLarge = headlineLarge.copy(fontFamily = f),
    headlineMedium = headlineMedium.copy(fontFamily = f),
    headlineSmall = headlineSmall.copy(fontFamily = f),
    titleLarge = titleLarge.copy(fontFamily = f),
    titleMedium = titleMedium.copy(fontFamily = f),
    titleSmall = titleSmall.copy(fontFamily = f),
    bodyLarge = bodyLarge.copy(fontFamily = f),
    bodyMedium = bodyMedium.copy(fontFamily = f),
    bodySmall = bodySmall.copy(fontFamily = f),
    labelLarge = labelLarge.copy(fontFamily = f),
    labelMedium = labelMedium.copy(fontFamily = f),
    labelSmall = labelSmall.copy(fontFamily = f),
)

@Composable
fun DcTheme(dark: Boolean, content: @Composable () -> Unit) {
    val colors = if (dark) DarkDc else LightDc
    CompositionLocalProvider(LocalDc provides colors) {
        MaterialTheme(colorScheme = scheme(colors), typography = Typography().inFamily(Estedad), content = content)
    }
}
