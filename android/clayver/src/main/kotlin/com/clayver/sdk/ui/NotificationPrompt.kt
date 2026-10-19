package com.clayver.sdk.ui

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.clayver.sdk.Clayver
import com.clayver.sdk.R
import com.clayver.sdk.internal.ClayverCore

/** What the notification banner of the customer chat offers. */
internal enum class NotificationPromptState {
    /** Notifications are on (or the prompt is disabled): no banner. */
    HIDDEN,

    /** Off, and the system permission dialog can still be shown (Android 13+). */
    REQUESTABLE,

    /** Off, and only the system Settings can turn them on. */
    BLOCKED,
}

internal object NotificationPrompt {
    private const val KEY_ASKED = "notificationPermissionAsked"

    /** Dismissed with the close button; stays hidden until the process ends. */
    var dismissed by mutableStateOf(false)

    fun state(context: Context): NotificationPromptState {
        if (Clayver.options?.showNotificationPrompt == false) return NotificationPromptState.HIDDEN
        val permissionGranted = Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (permissionGranted && NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            return NotificationPromptState.HIDDEN
        }
        if (Build.VERSION.SDK_INT >= 33 && !permissionGranted) {
            // Before the first request the rationale flag is false too, so remember whether
            // we (or the app, through this SDK) already asked: asked + no rationale means the
            // system will not show its dialog any more.
            if (!askedBefore(context)) return NotificationPromptState.REQUESTABLE
            val activity = context.findActivity()
            if (activity != null &&
                ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.POST_NOTIFICATIONS)
            ) {
                return NotificationPromptState.REQUESTABLE
            }
        }
        // Below Android 13 there is no runtime permission: notifications were turned off
        // in Settings. On 13+ the permission was permanently denied, or granted while the
        // app's notifications are blocked in Settings.
        return NotificationPromptState.BLOCKED
    }

    fun markAsked(context: Context) {
        ClayverCore.prefs(context).edit().putBoolean(KEY_ASKED, true).apply()
    }

    private fun askedBefore(context: Context): Boolean = ClayverCore.prefs(context).getBoolean(KEY_ASKED, false)

    /** Opens this app's notification settings, or its app info page where that screen is missing. */
    fun openSettings(context: Context) {
        val notificationSettings = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            // API 21-25 read the package from these extras.
            .putExtra("app_package", context.packageName)
            .putExtra("app_uid", context.applicationInfo.uid)
        val appDetails = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", context.packageName, null))
        for (intent in listOf(notificationSettings, appDetails)) {
            if (context.findActivity() == null) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(intent)
                return
            } catch (e: ActivityNotFoundException) {
                // Try the next screen.
            } catch (e: SecurityException) {
                // Try the next screen.
            }
        }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/**
 * Banner at the top of the customer chat while notifications are off. It asks for the
 * POST_NOTIFICATIONS permission while the system can still show its dialog, and
 * otherwise explains how to turn notifications on in Settings. Re-checked on resume,
 * so it disappears when the customer comes back from Settings with them on.
 */
@Composable
internal fun NotificationPromptBanner() {
    val context = LocalContext.current
    var state by remember { mutableStateOf(NotificationPromptState.HIDDEN) }
    var showSettingsDialog by remember { mutableStateOf(false) }
    LifecycleResumeEffect(context) {
        state = NotificationPrompt.state(context)
        onPauseOrDispose { }
    }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        state = NotificationPrompt.state(context)
    }

    if (state == NotificationPromptState.HIDDEN || NotificationPrompt.dismissed) return

    val colors = LocalClayverColors.current
    val blocked = state == NotificationPromptState.BLOCKED
    val onTurnOn: () -> Unit = {
        if (blocked || Build.VERSION.SDK_INT < 33) {
            showSettingsDialog = true
        } else {
            NotificationPrompt.markAsked(context)
            permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    Surface(color = colors.surface) {
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Notifications, contentDescription = null, tint = colors.accent)
            Text(
                stringResource(if (blocked) R.string.clayver_notifications_off else R.string.clayver_notifications_prompt),
                color = colors.onSurface,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
            )
            TextButton(onClick = onTurnOn) {
                Text(
                    stringResource(if (blocked) R.string.clayver_notifications_off_action else R.string.clayver_notifications_prompt_action),
                    color = colors.accent,
                )
            }
            IconButton(onClick = { NotificationPrompt.dismissed = true }) {
                Icon(
                    Icons.Filled.Close,
                    contentDescription = stringResource(R.string.clayver_notifications_dismiss),
                    tint = colors.secondaryText,
                )
            }
        }
    }
    HorizontalDivider(color = colors.divider)

    if (showSettingsDialog) {
        AlertDialog(
            onDismissRequest = { showSettingsDialog = false },
            title = { Text(stringResource(R.string.clayver_notifications_settings_title)) },
            text = { Text(stringResource(R.string.clayver_notifications_settings_body)) },
            confirmButton = {
                TextButton(onClick = {
                    showSettingsDialog = false
                    NotificationPrompt.openSettings(context)
                }) { Text(stringResource(R.string.clayver_notifications_open_settings), color = colors.accent) }
            },
            dismissButton = {
                TextButton(onClick = { showSettingsDialog = false }) {
                    Text(stringResource(R.string.clayver_notifications_not_now), color = colors.secondaryText)
                }
            },
            containerColor = colors.surface,
            titleContentColor = colors.onSurface,
            textContentColor = colors.secondaryText,
        )
    }
}
