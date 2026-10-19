package com.clayver.sdk.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/** Colours of the built-in chat UI. */
@Immutable
public data class ClayverColors(
    val accent: Color,
    val onAccent: Color,
    val background: Color,
    val surface: Color,
    val onSurface: Color,
    val secondaryText: Color,
    val customerBubble: Color,
    val onCustomerBubble: Color,
    val agentBubble: Color,
    val onAgentBubble: Color,
    val divider: Color,
    val error: Color,
) {
    public companion object {
        public val DefaultAccent: Color = Color(0xFF4F46E5)

        public fun light(accent: Color = DefaultAccent): ClayverColors = ClayverColors(
            accent = accent,
            onAccent = contentColorFor(accent),
            background = Color(0xFFF7F7FA),
            surface = Color.White,
            onSurface = Color(0xFF1B1B1F),
            secondaryText = Color(0xFF5E5E66),
            customerBubble = accent,
            onCustomerBubble = contentColorFor(accent),
            agentBubble = Color(0xFFE9E9EF),
            onAgentBubble = Color(0xFF1B1B1F),
            divider = Color(0xFFD0D0D8),
            error = Color(0xFFB3261E),
        )

        public fun dark(accent: Color = Color(0xFF8B85FF)): ClayverColors = ClayverColors(
            accent = accent,
            onAccent = contentColorFor(accent),
            background = Color(0xFF121216),
            surface = Color(0xFF1C1C22),
            onSurface = Color(0xFFE6E6EC),
            secondaryText = Color(0xFFA6A6B0),
            customerBubble = accent,
            onCustomerBubble = contentColorFor(accent),
            agentBubble = Color(0xFF2A2A33),
            onAgentBubble = Color(0xFFE6E6EC),
            divider = Color(0xFF3A3A44),
            error = Color(0xFFF2B8B5),
        )

        /** Black or white, whichever reads better on [background]. */
        public fun contentColorFor(background: Color): Color =
            if (background.luminance() > 0.45f) Color(0xFF111111) else Color.White
    }
}

@Immutable
public data class ClayverTypography(
    /** Font for the whole chat UI; null keeps the app's/system default. */
    val fontFamily: FontFamily? = null,
    val messageTextSize: TextUnit = 16.sp,
)

public enum class ClayverDarkMode { SYSTEM, LIGHT, DARK }

/**
 * Look of the built-in chat. Pass it in [com.clayver.sdk.ClayverOptions.theme]
 * (used by `openChat`) or directly to [ClayverChatScreen].
 */
@Immutable
public data class ClayverTheme(
    /** Toolbar title. Defaults to the workspace's team name, then "Support". */
    val title: String? = null,
    val lightColors: ClayverColors = ClayverColors.light(),
    val darkColors: ClayverColors = ClayverColors.dark(),
    val typography: ClayverTypography = ClayverTypography(),
    val darkMode: ClayverDarkMode = ClayverDarkMode.SYSTEM,
    /** Use `config/public/accentColor` from the workspace when the colours keep the default accent. */
    val useWorkspaceAccentColor: Boolean = true,
)

internal val LocalClayverColors = staticCompositionLocalOf { ClayverColors.light() }
internal val LocalClayverTypography = staticCompositionLocalOf { ClayverTypography() }

@Composable
internal fun ClayverThemeProvider(
    theme: ClayverTheme,
    workspaceAccent: String?,
    content: @Composable () -> Unit,
) {
    val dark = when (theme.darkMode) {
        ClayverDarkMode.SYSTEM -> isSystemInDarkTheme()
        ClayverDarkMode.LIGHT -> false
        ClayverDarkMode.DARK -> true
    }
    var colors = if (dark) theme.darkColors else theme.lightColors
    val defaultAccent = if (dark) ClayverColors.dark().accent else ClayverColors.DefaultAccent
    val override = ChatFormatting.parseHexColor(workspaceAccent)
    if (theme.useWorkspaceAccentColor && override != null && colors.accent == defaultAccent) {
        val accent = Color(override)
        colors = colors.copy(
            accent = accent,
            onAccent = ClayverColors.contentColorFor(accent),
            customerBubble = if (colors.customerBubble == defaultAccent) accent else colors.customerBubble,
            onCustomerBubble = if (colors.customerBubble == defaultAccent) ClayverColors.contentColorFor(accent) else colors.onCustomerBubble,
        )
    }
    val scheme: ColorScheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = colors.accent,
        onPrimary = colors.onAccent,
        background = colors.background,
        onBackground = colors.onSurface,
        surface = colors.surface,
        onSurface = colors.onSurface,
        onSurfaceVariant = colors.secondaryText,
        outline = colors.divider,
        error = colors.error,
    )
    val typography = theme.typography.fontFamily?.let { Typography().withFontFamily(it) } ?: Typography()
    CompositionLocalProvider(
        LocalClayverColors provides colors,
        LocalClayverTypography provides theme.typography,
    ) {
        MaterialTheme(colorScheme = scheme, typography = typography, content = content)
    }
}

private fun Typography.withFontFamily(f: FontFamily): Typography = Typography(
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
