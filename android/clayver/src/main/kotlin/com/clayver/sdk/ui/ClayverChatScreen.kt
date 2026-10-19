package com.clayver.sdk.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import com.clayver.sdk.Clayver
import com.clayver.sdk.ClayverAttachment
import com.clayver.sdk.ClayverAttachmentInput
import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverException
import com.clayver.sdk.ClayverMessage
import com.clayver.sdk.ClayverSenderType
import com.clayver.sdk.R
import com.clayver.sdk.fromUri
import com.clayver.sdk.internal.toClayverException
import com.clayver.sdk.notifications.ClayverNotifications
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * The Clayver chat as a composable: live messages, history, attachments, read
 * receipts and a composer. Embed it anywhere in a Compose hierarchy, or use
 * [Clayver.openChat] for a ready-made activity. While the customer is blocked
 * the composer is replaced by a notice.
 *
 * @param conversationId conversation to show; null shows the customer's latest
 *   open conversation, or starts a new one on the first message.
 * @param newConversation with no [conversationId], starts an empty chat whose
 *   first message always creates a new conversation (see [ClayverConversationListScreen]).
 * @param onClose shows a close button at the end of the toolbar when set.
 * @param onBack shows a back button at the start of the toolbar when set
 *   (e.g. back to the conversation list).
 */
@Composable
public fun ClayverChatScreen(
    modifier: Modifier = Modifier,
    conversationId: String? = null,
    theme: ClayverTheme = Clayver.theme,
    onClose: (() -> Unit)? = null,
    newConversation: Boolean = false,
    onBack: (() -> Unit)? = null,
) {
    val key = when {
        conversationId != null -> conversationId
        newConversation -> "new"
        else -> "latest"
    }
    ChatScreen(modifier, conversationId, newConversation, "clayver-chat:$key", theme, onClose, onBack)
}

/** [ClayverChatScreen] with an explicit view model key, so the navigation can open several new chats. */
@Composable
internal fun ChatScreen(
    modifier: Modifier,
    conversationId: String?,
    newConversation: Boolean,
    viewModelKey: String,
    theme: ClayverTheme,
    onClose: (() -> Unit)?,
    onBack: (() -> Unit)?,
) {
    val vm: ChatViewModel = viewModel(
        key = viewModelKey,
        factory = ChatViewModel.factory(conversationId, newConversation),
    )
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LifecycleResumeEffect(vm, state.conversationId) {
        vm.setVisible(true)
        state.conversationId?.let { ClayverNotifications.cancel(context, it) }
        onPauseOrDispose { vm.setVisible(false) }
    }
    ClayverThemeProvider(theme, state.config?.accentColor) {
        ChatContent(
            state = state,
            title = theme.title ?: state.config?.teamName ?: stringResource(R.string.clayver_chat_title),
            vm = vm,
            onClose = onClose,
            onBack = onBack,
            modifier = modifier,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatContent(
    state: ChatUiState,
    title: String,
    vm: ChatViewModel,
    onClose: (() -> Unit)?,
    onBack: (() -> Unit)?,
    modifier: Modifier,
) {
    val colors = LocalClayverColors.current
    Column(modifier.fillMaxSize().background(colors.background)) {
        TopAppBar(
            title = { Text(title, modifier = Modifier.semantics { heading() }) },
            navigationIcon = {
                if (onBack != null) {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.clayver_back_to_conversations))
                    }
                }
            },
            actions = {
                if (onClose != null) {
                    IconButton(onClick = onClose) {
                        Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.clayver_close))
                    }
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = colors.surface,
                titleContentColor = colors.onSurface,
                navigationIconContentColor = colors.onSurface,
                actionIconContentColor = colors.onSurface,
            ),
        )
        // Asks for notification permission (or points to Settings) while notifications are off.
        NotificationPromptBanner()
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (val phase = state.phase) {
                ChatPhase.Loading -> LoadingState()
                is ChatPhase.Failed -> ErrorState(phase.error, onRetry = vm::retry)
                ChatPhase.Ready ->
                    if (state.items.isEmpty()) {
                        EmptyState(state.config?.welcomeMessage)
                    } else {
                        MessageList(
                            model = MessageListModel(
                                items = state.items,
                                unreadDividerBeforeId = state.unreadDividerBeforeId,
                                seenMessageId = state.seenMessageId,
                                hasOlder = state.hasOlder,
                                loadingOlder = state.loadingOlder,
                                olderError = state.olderError,
                            ),
                            actions = vm,
                            perspective = ChatPerspective.CUSTOMER,
                            senderLabel = { customerSideLabel(it.senderType, it.senderName) },
                        )
                    }
            }
        }
        if (state.blocked != null) {
            BlockedNotice()
        } else if (state.phase !is ChatPhase.Failed) {
            Composer(
                model = ComposerModel(state.draft, state.pendingAttachment, state.composerError, state.canSend),
                actions = vm,
                enabled = state.phase == ChatPhase.Ready,
            )
        }
    }
}

/** Shown instead of the composer while the customer is blocked. */
@Composable
private fun BlockedNotice() {
    val colors = LocalClayverColors.current
    Surface(color = colors.surface, shadowElevation = 4.dp) {
        Text(
            stringResource(R.string.clayver_blocked),
            color = colors.secondaryText,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 16.dp, vertical = 16.dp)
                .semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}

// region states

@Composable
internal fun LoadingState() {
    val description = stringResource(R.string.clayver_loading)
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(Modifier.semantics { contentDescription = description })
    }
}

@Composable
internal fun ErrorState(error: ClayverException, onRetry: () -> Unit) {
    val colors = LocalClayverColors.current
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Filled.Warning, contentDescription = null, tint = colors.error)
        Spacer(Modifier.height(12.dp))
        Text(
            errorMessage(error),
            color = colors.onSurface,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
        )
        Spacer(Modifier.height(16.dp))
        Button(onClick = onRetry) { Text(stringResource(R.string.clayver_retry)) }
    }
}

@Composable
private fun EmptyState(welcomeMessage: String?) {
    val colors = LocalClayverColors.current
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            stringResource(R.string.clayver_empty_title),
            style = MaterialTheme.typography.titleMedium,
            color = colors.onSurface,
            modifier = Modifier.semantics { heading() },
        )
        Spacer(Modifier.height(8.dp))
        Text(
            welcomeMessage ?: stringResource(R.string.clayver_empty_body),
            color = colors.secondaryText,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
internal fun errorMessage(error: ClayverException): String = stringResource(
    when (error.code) {
        ClayverErrorCode.NOT_CONFIGURED -> R.string.clayver_error_not_configured
        ClayverErrorCode.NOT_AUTHENTICATED -> R.string.clayver_error_not_authenticated
        ClayverErrorCode.PERMISSION_DENIED -> R.string.clayver_error_permission_denied
        ClayverErrorCode.INVALID_ARGUMENT -> R.string.clayver_error_invalid_argument
        ClayverErrorCode.NETWORK -> R.string.clayver_error_network
        ClayverErrorCode.ATTACHMENT_TOO_LARGE -> R.string.clayver_error_attachment_too_large
        ClayverErrorCode.UNSUPPORTED_ATTACHMENT_TYPE -> R.string.clayver_error_unsupported_attachment
        ClayverErrorCode.CANCELLED -> R.string.clayver_error_cancelled
        ClayverErrorCode.INTERNAL -> R.string.clayver_error_internal
    },
)

// endregion

// region message list

/** What the shared message list shows; built from either screen's state. */
internal class MessageListModel(
    val items: List<ChatItem>,
    val unreadDividerBeforeId: String?,
    val seenMessageId: String?,
    val hasOlder: Boolean,
    val loadingOlder: Boolean,
    val olderError: ClayverException?,
)

/** Callbacks of the shared message list, implemented by both view models. */
internal interface MessageListActions {
    fun loadOlder()
    fun retrySend(key: String)
    fun discard(key: String)
    suspend fun attachmentUrl(storagePath: String): String
}

@Composable
internal fun MessageList(
    model: MessageListModel,
    actions: MessageListActions,
    perspective: ChatPerspective,
    senderLabel: @Composable (ClayverMessage) -> String,
) {
    val now = remember(model.items.size) { System.currentTimeMillis() }
    val rows = remember(model.items, model.unreadDividerBeforeId, model.seenMessageId, now) {
        // reverseLayout: index 0 is the newest row
        ChatFormatting.rows(model.items, model.unreadDividerBeforeId, model.seenMessageId, now).asReversed()
    }
    val listState = rememberLazyListState()
    val newest = model.items.lastOrNull()
    val view = LocalView.current
    val announcement = newest?.let { stringResource(R.string.clayver_new_message_announcement, senderLabel(it.message)) }

    // Follow new messages when the user is at the bottom or just sent one; announce incoming ones.
    LaunchedEffect(newest?.key) {
        if (newest == null) return@LaunchedEffect
        val own = perspective.isOwnSide(newest.message)
        if (own || listState.firstVisibleItemIndex <= 2) listState.animateScrollToItem(0)
        if (!own && !newest.isLocal && announcement != null) {
            @Suppress("DEPRECATION")
            view.announceForAccessibility(announcement)
        }
    }

    // Load older pages when the top of the history becomes visible.
    val atTop by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val lastVisible = info.visibleItemsInfo.lastOrNull()?.index ?: return@derivedStateOf false
            info.totalItemsCount > 0 && lastVisible >= info.totalItemsCount - 2
        }
    }
    LaunchedEffect(atTop, model.hasOlder, model.items.size) {
        if (atTop && model.hasOlder && model.olderError == null) actions.loadOlder()
    }

    LazyColumn(
        state = listState,
        reverseLayout = true,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
    ) {
        items(rows, key = { it.key }, contentType = { it::class.simpleName }) { row ->
            when (row) {
                is ChatRow.DayHeader -> DayHeaderRow(row.label)
                ChatRow.UnreadDivider -> UnreadDividerRow()
                is ChatRow.Message -> MessageRow(row, actions, perspective, senderLabel(row.item.message))
            }
        }
        if (model.hasOlder || model.loadingOlder || model.olderError != null) {
            item(key = "load-older") { OlderRow(model, onLoad = actions::loadOlder) }
        }
    }
}

@Composable
private fun OlderRow(state: MessageListModel, onLoad: () -> Unit) {
    Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) {
        when {
            state.loadingOlder -> {
                val description = stringResource(R.string.clayver_loading_older)
                CircularProgressIndicator(Modifier.size(24.dp).semantics { contentDescription = description })
            }
            state.olderError != null -> TextButton(onClick = onLoad) { Text(stringResource(R.string.clayver_older_failed)) }
            else -> TextButton(onClick = onLoad) { Text(stringResource(R.string.clayver_load_older)) }
        }
    }
}

@Composable
private fun DayHeaderRow(label: DayLabel) {
    val text = when (label) {
        DayLabel.Today -> stringResource(R.string.clayver_today)
        DayLabel.Yesterday -> stringResource(R.string.clayver_yesterday)
        is DayLabel.Date -> label.text
    }
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        color = LocalClayverColors.current.secondaryText,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp).semantics { heading() },
    )
}

@Composable
private fun UnreadDividerRow() {
    val colors = LocalClayverColors.current
    Row(
        Modifier.fillMaxWidth().padding(vertical = 8.dp).semantics(mergeDescendants = true) { heading() },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        HorizontalDivider(Modifier.weight(1f), color = colors.accent)
        Text(
            stringResource(R.string.clayver_unread_divider),
            style = MaterialTheme.typography.labelMedium,
            color = colors.accent,
            modifier = Modifier.padding(horizontal = 8.dp),
        )
        HorizontalDivider(Modifier.weight(1f), color = colors.accent)
    }
}

/** Sender labels in the customer chat. */
@Composable
private fun customerSideLabel(type: ClayverSenderType, name: String?): String = when (type) {
    ClayverSenderType.CUSTOMER -> stringResource(R.string.clayver_you)
    ClayverSenderType.SYSTEM -> stringResource(R.string.clayver_system)
    ClayverSenderType.AGENT -> name?.takeIf { it.isNotBlank() } ?: stringResource(R.string.clayver_support_agent)
}

@Composable
private fun MessageRow(row: ChatRow.Message, vm: MessageListActions, perspective: ChatPerspective, sender: String) {
    val colors = LocalClayverColors.current
    val typography = LocalClayverTypography.current
    val item = row.item
    val message = item.message
    val mine = perspective.isOwnSide(message)
    val time = remember(message.createdAt) { ChatFormatting.time(message.createdAt) }
    val status = when (item.delivery) {
        DeliveryState.SENDING -> stringResource(R.string.clayver_sending)
        DeliveryState.FAILED -> stringResource(R.string.clayver_failed)
        DeliveryState.SENT -> if (row.seen) stringResource(R.string.clayver_seen) else null
    }
    val attachmentText = message.attachment?.let {
        stringResource(if (it.isImage) R.string.clayver_a11y_image else R.string.clayver_a11y_attachment, it.fileName)
    }
    val description = listOfNotNull(
        stringResource(R.string.clayver_a11y_message, sender, message.text.orEmpty()),
        attachmentText,
        time,
        status,
    ).joinToString(". ")
    val retryLabel = stringResource(R.string.clayver_retry)
    val deleteLabel = stringResource(R.string.clayver_delete)
    val failed = item.delivery == DeliveryState.FAILED

    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp)
            .semantics(mergeDescendants = true) {
                contentDescription = description
                if (failed) {
                    customActions = listOf(
                        CustomAccessibilityAction(retryLabel) { vm.retrySend(item.key); true },
                        CustomAccessibilityAction(deleteLabel) { vm.discard(item.key); true },
                    )
                }
            },
        horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
    ) {
        if (row.showSender) {
            Text(
                sender,
                style = MaterialTheme.typography.labelMedium,
                color = colors.secondaryText,
                modifier = Modifier.padding(start = 12.dp, end = 12.dp, top = 6.dp, bottom = 2.dp).clearAndSetSemantics { },
            )
        }
        val bubbleColor = when {
            mine -> colors.customerBubble
            message.senderType == ClayverSenderType.SYSTEM -> Color.Transparent
            else -> colors.agentBubble
        }
        val onBubble = if (mine) colors.onCustomerBubble else colors.onAgentBubble
        val shape = if (mine) RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp) else RoundedCornerShape(18.dp, 18.dp, 18.dp, 4.dp)
        Surface(
            color = bubbleColor,
            contentColor = onBubble,
            shape = shape,
            modifier = Modifier
                .widthIn(max = 300.dp)
                .then(if (failed) Modifier.clickable(onClickLabel = retryLabel) { vm.retrySend(item.key) } else Modifier),
        ) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                message.attachment?.let { AttachmentView(it, item.isLocal, onBubble, vm) }
                message.text?.let {
                    if (message.attachment != null) Spacer(Modifier.height(6.dp))
                    Text(
                        it,
                        color = onBubble,
                        fontSize = typography.messageTextSize,
                        modifier = Modifier.clearAndSetSemantics { },
                    )
                }
            }
        }
        Row(
            Modifier.padding(horizontal = 8.dp, vertical = 2.dp).clearAndSetSemantics { },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(time, style = MaterialTheme.typography.labelSmall, color = colors.secondaryText)
            status?.let {
                Text(
                    " · $it",
                    style = MaterialTheme.typography.labelSmall,
                    color = if (failed) colors.error else colors.secondaryText,
                )
            }
        }
        if (failed) {
            Row(Modifier.clearAndSetSemantics { }) {
                TextButton(onClick = { vm.retrySend(item.key) }) { Text(retryLabel) }
                TextButton(onClick = { vm.discard(item.key) }) { Text(deleteLabel) }
            }
        }
    }
}

@Composable
private fun AttachmentView(attachment: ClayverAttachment, isLocal: Boolean, contentColor: Color, repository: MessageListActions) {
    val colors = LocalClayverColors.current
    val context = LocalContext.current
    if (isLocal || attachment.storagePath.isEmpty()) {
        val uploading = stringResource(R.string.clayver_uploading, attachment.fileName)
        FileChip(attachment.fileName, attachment.size, contentColor, Modifier.semantics { contentDescription = uploading }, uploading = true)
        return
    }
    val url by produceState<String?>(initialValue = null, attachment.storagePath) {
        value = try {
            repository.attachmentUrl(attachment.storagePath)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            null
        }
    }
    val openLabel = stringResource(R.string.clayver_open_attachment, attachment.fileName)
    if (attachment.isImage) {
        val description = stringResource(R.string.clayver_a11y_image, attachment.fileName)
        val w = attachment.width
        val h = attachment.height
        val ratio = if (w != null && h != null && w > 0 && h > 0) (w.toFloat() / h).coerceIn(0.5f, 2f) else 4f / 3f
        Box(
            Modifier
                .width(220.dp)
                .aspectRatio(ratio)
                .clip(RoundedCornerShape(12.dp))
                .background(colors.divider)
                .clickable(enabled = url != null, onClickLabel = openLabel) { url?.let { openUrl(context, it) } }
                .semantics {
                    contentDescription = description
                    role = Role.Image
                },
            contentAlignment = Alignment.Center,
        ) {
            val loaded = url
            if (loaded == null) {
                CircularProgressIndicator(Modifier.size(24.dp), color = contentColor)
            } else {
                AsyncImage(
                    model = loaded,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    } else {
        FileChip(
            attachment.fileName,
            attachment.size,
            contentColor,
            Modifier.clickable(enabled = url != null, onClickLabel = openLabel, role = Role.Button) {
                url?.let { openUrl(context, it) }
            },
            uploading = false,
        )
    }
}

@Composable
private fun FileChip(name: String, size: Long, contentColor: Color, modifier: Modifier, uploading: Boolean) {
    Row(modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(painterResource(R.drawable.clayver_ic_file), contentDescription = null, tint = contentColor)
        Spacer(Modifier.width(8.dp))
        Column(Modifier.clearAndSetSemantics { }) {
            Text(name, color = contentColor, style = MaterialTheme.typography.bodyMedium, maxLines = 2)
            if (size > 0) {
                Text(ChatFormatting.fileSize(size), color = contentColor.copy(alpha = 0.75f), style = MaterialTheme.typography.labelSmall)
            }
        }
        if (uploading) {
            Spacer(Modifier.width(8.dp))
            CircularProgressIndicator(Modifier.size(16.dp), color = contentColor, strokeWidth = 2.dp)
        }
    }
}

private fun openUrl(context: Context, url: String) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: ActivityNotFoundException) {
        // No app can open it; nothing else to do.
    }
}

// endregion

// region composer

internal class ComposerModel(
    val draft: String,
    val pendingAttachment: ClayverAttachmentInput?,
    val composerError: ClayverException?,
    val canSend: Boolean,
)

/** Callbacks of the shared composer, implemented by both view models. */
internal interface ComposerActions {
    fun onDraftChange(text: String)
    fun attach(input: ClayverAttachmentInput)
    fun reportComposerError(error: Throwable)
    fun removeAttachment()
    fun send()
}

@Composable
internal fun Composer(
    model: ComposerModel,
    actions: ComposerActions,
    enabled: Boolean,
    hint: String = stringResource(R.string.clayver_composer_hint),
) {
    val state = model
    val vm = actions
    val colors = LocalClayverColors.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    fun attachUri(uri: Uri?) {
        if (uri == null) return
        scope.launch {
            try {
                vm.attach(ClayverAttachmentInput.fromUri(context, uri))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                vm.reportComposerError(e.toClayverException())
            }
        }
    }

    // Photos only: the picker is limited to images, which fromUri compresses to a JPEG of at most 300 KB.
    val photoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { attachUri(it) }

    Surface(color = colors.surface, shadowElevation = 4.dp) {
        Column(Modifier.navigationBarsPadding().imePadding().padding(horizontal = 8.dp, vertical = 6.dp)) {
            state.composerError?.let {
                Text(
                    errorMessage(it),
                    color = colors.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp).semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            state.pendingAttachment?.let { pending ->
                val removeLabel = stringResource(R.string.clayver_remove_attachment, pending.fileName)
                Row(
                    Modifier
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(colors.agentBubble)
                        .padding(start = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    FileChip(pending.fileName, pending.size ?: 0L, colors.onAgentBubble, Modifier.weight(1f, fill = false), uploading = false)
                    IconButton(onClick = vm::removeAttachment) {
                        Icon(Icons.Filled.Close, contentDescription = removeLabel, tint = colors.onAgentBubble)
                    }
                }
            }
            Row(verticalAlignment = Alignment.Bottom) {
                IconButton(
                    onClick = { photoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                    enabled = enabled,
                ) {
                    Icon(
                        painterResource(R.drawable.clayver_ic_attach),
                        contentDescription = stringResource(R.string.clayver_attach_photo),
                        tint = colors.secondaryText,
                    )
                }
                OutlinedTextField(
                    value = state.draft,
                    onValueChange = vm::onDraftChange,
                    modifier = Modifier.weight(1f),
                    placeholder = { Text(hint) },
                    maxLines = 5,
                    shape = RoundedCornerShape(24.dp),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                )
                val canSend = enabled && state.canSend
                IconButton(onClick = vm::send, enabled = canSend) {
                    Icon(
                        Icons.AutoMirrored.Filled.Send,
                        contentDescription = stringResource(R.string.clayver_send),
                        tint = if (canSend) colors.accent else colors.secondaryText,
                    )
                }
            }
        }
    }
}

// endregion
