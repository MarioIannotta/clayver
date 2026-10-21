package com.clayver.example

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clayver.sdk.Clayver
import com.clayver.sdk.ClayverAgentRole
import com.clayver.sdk.ClayverException
import com.google.firebase.auth.EmailAuthProvider
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // A Clayver push tapped while the app was in the background lands here.
        if (savedInstanceState == null) Clayver.handleIntent(this, intent)
        setContent { MaterialTheme { Surface { HomeScreen() } } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        Clayver.handleIntent(this, intent)
    }
}

@Composable
private fun HomeScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val auth = remember { FirebaseAuth.getInstance() }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("Anonymous visitor") }
    // Users sign in with Firebase Auth; Clayver follows the signed-in user on its own
    // (the customer id is the Firebase uid). Null while signed out or anonymous.
    var signedInEmail by remember { mutableStateOf<String?>(null) }
    DisposableEffect(auth) {
        val listener = FirebaseAuth.AuthStateListener { a ->
            val user = a.currentUser
            signedInEmail = if (user == null || user.isAnonymous) null else user.email ?: user.uid
        }
        auth.addAuthStateListener(listener)
        onDispose { auth.removeAuthStateListener(listener) }
    }
    // Agent mode: support staff signed into this app can answer customers from it.
    var agentRole by remember { mutableStateOf<ClayverAgentRole?>(null) }
    LaunchedEffect(signedInEmail) {
        agentRole = try {
            // A fresh sign-in carries a fresh ID token, so a granted role applies right away.
            Clayver.agentRole()
        } catch (e: ClayverException) {
            null
        }
    }

    val unreadFlow = remember { Clayver.unreadCountFlow().catch { emit(0) } }
    val unread by unreadFlow.collectAsStateWithLifecycle(initialValue = 0)

    // Push notifications: ask for permission to show them (Android 13+), then register this
    // device's FCM token with Clayver.setPushToken. Token refreshes reach the SDK through
    // ExampleMessagingService.onNewToken, and the SDK re-registers the saved token on launch
    // and after sign-in changes, so this is needed once per install.
    var pushStatus by remember { mutableStateOf(pushStatusText(context, registered = false)) }
    fun registerPushToken() {
        scope.launch {
            pushStatus = try {
                val token = FirebaseMessaging.getInstance().token.await()
                Clayver.setPushToken(token)
                pushStatusText(context, registered = true)
            } catch (e: ClayverException) {
                "Push registration failed: ${e.code.wireName}"
            } catch (e: Exception) {
                "Could not get the FCM token: ${e.message}"
            }
        }
    }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        // Register even when denied: the token stays valid, and notifications show once the
        // user allows them later (the chat screen offers that with a banner).
        registerPushToken()
    }

    Column(
        Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Clayver example", style = MaterialTheme.typography.headlineSmall)
        Text(status, style = MaterialTheme.typography.bodyMedium)

        if (signedInEmail == null) {
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("Email") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Password") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                enabled = email.isNotBlank() && password.isNotEmpty(),
                onClick = {
                    scope.launch {
                        status = try {
                            val user = auth.signInWithEmailAndPassword(email, password).await().user
                            Clayver.setUserProperties(
                                mapOf(
                                    Clayver.UserProperty.NAME to email.substringBefore('@'),
                                    // Your own user id; the example has none, so it reuses the Firebase uid.
                                    Clayver.UserProperty.UID to (user?.uid ?: ""),
                                    "plan" to "pro",
                                ),
                            )
                            "Signed in"
                        } catch (e: Exception) {
                            "Sign-in failed: ${e.message}"
                        }
                    }
                },
            ) { Text("Log in") }
            OutlinedButton(
                enabled = email.isNotBlank() && password.isNotEmpty(),
                onClick = {
                    scope.launch {
                        status = try {
                            // Linking the anonymous user keeps its uid, so conversations started
                            // before sign-up stay with the new account.
                            val anonymous = auth.currentUser?.takeIf { it.isAnonymous }
                            if (anonymous != null) {
                                anonymous.linkWithCredential(EmailAuthProvider.getCredential(email, password)).await()
                            } else {
                                auth.createUserWithEmailAndPassword(email, password).await()
                            }
                            Clayver.setUserProperties(
                                mapOf(
                                    Clayver.UserProperty.NAME to email.substringBefore('@'),
                                    Clayver.UserProperty.UID to (auth.currentUser?.uid ?: ""),
                                    "plan" to "pro",
                                ),
                            )
                            "Account created"
                        } catch (e: Exception) {
                            "Sign-up failed: ${e.message}"
                        }
                    }
                },
            ) { Text("Create account") }
        } else {
            Text("Signed in as $signedInEmail")
            OutlinedButton(
                onClick = {
                    scope.launch {
                        status = try {
                            // Remove this device's push registrations while still signed in,
                            // then sign out of Firebase Auth.
                            Clayver.logout()
                            auth.signOut()
                            "Anonymous visitor"
                        } catch (e: ClayverException) {
                            "logout failed: ${e.code.wireName}"
                        }
                    }
                },
            ) { Text("Log out") }
        }

        BadgedBox(
            badge = {
                if (unread > 0) {
                    Badge(Modifier.semantics { contentDescription = "$unread unread support messages" }) {
                        Text(if (unread > 99) "99+" else unread.toString())
                    }
                }
            },
        ) {
            Button(onClick = { Clayver.openChat(context) }) { Text("Contact support") }
        }

        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            OutlinedButton(
                onClick = {
                    if (Build.VERSION.SDK_INT >= 33 &&
                        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
                        PackageManager.PERMISSION_GRANTED
                    ) {
                        permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else {
                        registerPushToken()
                    }
                },
            ) { Text("Register for push notifications") }
            Text(pushStatus, style = MaterialTheme.typography.bodySmall)
        }

        // Shown only to agents and admins of the workspace (claim clayver_roles[projectId]).
        // The database rules enforce the role on every read and write regardless.
        agentRole?.let { role ->
            val label = if (role == ClayverAgentRole.ADMIN) "admin" else "agent"
            Text(
                "You are a support $label: open the chat and tap \"Switch to support agent\".",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

private fun pushStatusText(context: Context, registered: Boolean): String {
    val enabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
    val registration = if (registered) "Push token registered" else "Push token not registered yet"
    return registration + if (enabled) " · notifications allowed" else " · notifications off"
}
