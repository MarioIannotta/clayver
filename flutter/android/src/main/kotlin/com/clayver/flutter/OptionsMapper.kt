// Copyright (c) Clayver contributors. Licensed under the Apache License 2.0.

package com.clayver.flutter

import android.content.Context
import android.util.Log
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import com.clayver.sdk.ClayverEmulator
import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverOptions
import com.clayver.sdk.ui.ClayverColors
import com.clayver.sdk.ui.ClayverTheme
import com.clayver.sdk.ui.ClayverTypography
import com.google.firebase.FirebaseApp

/** Converts the Pigeon options to the native [ClayverOptions]. */
internal object OptionsMapper {
    private const val TAG = "ClayverFlutter"

    fun toOptions(context: Context, dto: ClayverOptionsDto): ClayverOptions {
        val appName = dto.firebaseAppName
        if (appName != null && FirebaseApp.getApps(context).none { it.name == appName }) {
            throw ClayverFlutterError(
                ClayverErrorCode.INVALID_ARGUMENT.wireName,
                "No Firebase app named \"$appName\". Initialize it with Firebase.initializeApp(name:) first.",
                null,
            )
        }
        val defaultEmulator = ClayverEmulator()
        return ClayverOptions(
            projectId = dto.projectId,
            functionsRegion = dto.functionsRegion,
            databaseURL = dto.databaseURL,
            firebaseAppName = appName,
            theme = dto.theme?.let { toTheme(context, it) } ?: ClayverTheme(),
            emulator = dto.emulator?.let {
                ClayverEmulator(
                    host = it.host ?: defaultEmulator.host,
                    authPort = it.authPort.toInt(),
                    databasePort = it.databasePort.toInt(),
                    functionsPort = it.functionsPort.toInt(),
                    storagePort = it.storagePort.toInt(),
                )
            },
            multipleConversations = dto.multipleConversations,
            signInAnonymously = dto.signInAnonymously,
        )
    }

    /**
     * Flutter passes one set of colours; it is applied to both the light and
     * the dark palette. Unset colours keep the SDK defaults (and the workspace
     * accent colour, when the accent is not overridden).
     */
    fun toTheme(context: Context, dto: ClayverThemeDto): ClayverTheme {
        val accent = dto.accentColor?.let(::color)
        fun ClayverColors.withOverrides(): ClayverColors {
            var colors = this
            if (accent != null) {
                colors = colors.copy(
                    accent = accent,
                    onAccent = ClayverColors.contentColorFor(accent),
                    customerBubble = accent,
                    onCustomerBubble = ClayverColors.contentColorFor(accent),
                )
            }
            dto.customerBubbleColor?.let(::color)?.let {
                colors = colors.copy(customerBubble = it, onCustomerBubble = ClayverColors.contentColorFor(it))
            }
            dto.customerTextColor?.let(::color)?.let { colors = colors.copy(onCustomerBubble = it) }
            dto.agentBubbleColor?.let(::color)?.let { colors = colors.copy(agentBubble = it) }
            dto.agentTextColor?.let(::color)?.let { colors = colors.copy(onAgentBubble = it) }
            return colors
        }
        val defaults = ClayverTheme()
        return defaults.copy(
            title = dto.title,
            lightColors = defaults.lightColors.withOverrides(),
            darkColors = defaults.darkColors.withOverrides(),
            typography = dto.fontFamily?.let { fontFamily(context, it) }
                ?.let { defaults.typography.copy(fontFamily = it) }
                ?: defaults.typography,
        )
    }

    /** ARGB integer (`Color.toARGB32()` in Dart) to a Compose colour. */
    private fun color(argb: Long): Color = Color(argb.toInt())

    /** Resolves `res/font/<name>` of the host app. */
    private fun fontFamily(context: Context, name: String): FontFamily? {
        val resource = name.lowercase().replace(Regex("[^a-z0-9_]"), "_")
        @Suppress("DiscouragedApi")
        val id = context.resources.getIdentifier(resource, "font", context.packageName)
        if (id == 0) {
            Log.w(TAG, "Font resource res/font/$resource not found; using the default font.")
            return null
        }
        return FontFamily(Font(id))
    }
}
