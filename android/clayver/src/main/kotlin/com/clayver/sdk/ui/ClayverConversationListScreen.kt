package com.clayver.sdk.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.clayver.sdk.Clayver
import com.clayver.sdk.R
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first

/**
 * The customer's conversations, newest first: last message preview, time,
 * unread badge (customers never see whether the team closed a conversation),
 * plus a **New conversation** button. Tapping a row or the button opens the chat inside
 * this composable (with a back button to the list), unless the matching
 * callback is set. [Clayver.openConversations] shows it in a ready-made activity.
 *
 * @param onClose shows a close button at the end of the toolbar when set; chats
 *   opened from the list show it too, next to their back button.
 * @param onOpenConversation handle navigation yourself and show
 *   [ClayverChatScreen] for the id.
 * @param onNewConversation handle navigation yourself and show
 *   `ClayverChatScreen(newConversation = true)`.
 */
@Composable
public fun ClayverConversationListScreen(
    modifier: Modifier = Modifier,
    theme: ClayverTheme = Clayver.theme,
    onClose: (() -> Unit)? = null,
    onOpenConversation: ((conversationId: String) -> Unit)? = null,
    onNewConversation: (() -> Unit)? = null,
) {
    if (onOpenConversation != null && onNewConversation != null) {
        ConversationListPane(modifier, theme, onClose, onOpenConversation, onNewConversation)
    } else {
        ChatNavHost(listOf(ChatDestination.List), modifier, theme, onClose, onOpenConversation, onNewConversation)
    }
}

// region navigation

/**
 * The built-in chat's entry point (used by [com.clayver.sdk.ClayverChatActivity]):
 * decides between the list, a conversation and a new chat (see
 * [ConversationRouting]), reading the customer's conversations when needed.
 */
@Composable
internal fun ClayverChatRoot(
    entry: ChatEntry,
    conversationId: String?,
    theme: ClayverTheme,
    onClose: () -> Unit,
) {
    val multiple = Clayver.options?.multipleConversations ?: true
    val needsCount = ConversationRouting.needsConversationCount(entry, conversationId, multiple)
    var hasConversations by rememberSaveable { mutableStateOf<Boolean?>(null) }
    if (needsCount && hasConversations == null) {
        LaunchedEffect(Unit) {
            hasConversations = try {
                Clayver.conversationsFlow().first().isNotEmpty()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                true // the list shows the error with a retry
            }
        }
    }
    val stack = ConversationRouting.initialStack(entry, conversationId, multiple, hasConversations)
    if (stack == null) {
        ClayverThemeProvider(theme, workspaceAccent = null) {
            Box(Modifier.fillMaxSize().background(LocalClayverColors.current.background)) { LoadingState() }
        }
        return
    }
    ChatNavHost(stack, Modifier, theme, onClose)
}

private val StackSaver: Saver<List<ChatDestination>, Any> = Saver(
    save = { stack -> ArrayList(stack.map(ConversationRouting::encode)) },
    restore = { saved -> (saved as? List<*>)?.mapNotNull { (it as? String)?.let(ConversationRouting::decode) }?.ifEmpty { null } },
)

/**
 * A back stack of the list and chats. The top destination is shown; chats
 * above another destination get a back button (start of the toolbar) that
 * pops to it. Every screen gets [onClose] (end of the toolbar), which closes
 * the whole support UI.
 */
@Composable
internal fun ChatNavHost(
    initialStack: List<ChatDestination>,
    modifier: Modifier,
    theme: ClayverTheme,
    onClose: (() -> Unit)?,
    onOpenConversation: ((String) -> Unit)? = null,
    onNewConversation: (() -> Unit)? = null,
) {
    var stack by rememberSaveable(stateSaver = StackSaver) { mutableStateOf(initialStack) }
    // Each new chat gets its own view model; tokens are never reused.
    var nextToken by rememberSaveable { mutableIntStateOf(initialStack.maxOf { (it as? ChatDestination.New)?.token ?: 0 } + 1) }
    val root = stack.size == 1
    val pop: () -> Unit = { stack = stack.dropLast(1) }
    if (!root) BackHandler(onBack = pop)
    val back = if (root) null else pop

    when (val top = stack.last()) {
        ChatDestination.List -> ConversationListPane(
            modifier = modifier,
            theme = theme,
            onClose = onClose,
            onOpen = { id ->
                if (onOpenConversation != null) onOpenConversation(id) else stack = stack + ChatDestination.Conversation(id)
            },
            onNew = {
                if (onNewConversation != null) {
                    onNewConversation()
                } else {
                    stack = stack + ChatDestination.New(nextToken)
                    nextToken++
                }
            },
        )
        ChatDestination.Latest -> ChatScreen(modifier, null, false, "clayver-chat:latest", theme, onClose, back)
        is ChatDestination.New -> ChatScreen(modifier, null, true, "clayver-chat:new:${top.token}", theme, onClose, back)
        is ChatDestination.Conversation -> ChatScreen(modifier, top.id, false, "clayver-chat:${top.id}", theme, onClose, back)
    }
}

// endregion

// region list

@Composable
private fun ConversationListPane(
    modifier: Modifier,
    theme: ClayverTheme,
    onClose: (() -> Unit)?,
    onOpen: (String) -> Unit,
    onNew: () -> Unit,
) {
    val vm: ConversationListViewModel = viewModel(key = "clayver-conversations", factory = ConversationListViewModel.factory())
    val state by vm.state.collectAsStateWithLifecycle()
    ClayverThemeProvider(theme, state.config?.accentColor) {
        ConversationListContent(
            state = state,
            title = theme.title ?: state.config?.teamName ?: stringResource(R.string.clayver_chat_title),
            onRetry = vm::retry,
            onClose = onClose,
            onOpen = onOpen,
            onNew = onNew,
            modifier = modifier,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConversationListContent(
    state: ConversationListUiState,
    title: String,
    onRetry: () -> Unit,
    onClose: (() -> Unit)?,
    onOpen: (String) -> Unit,
    onNew: () -> Unit,
    modifier: Modifier,
) {
    val colors = LocalClayverColors.current
    Column(modifier.fillMaxSize().background(colors.background)) {
        TopAppBar(
            title = { Text(title, modifier = Modifier.semantics { heading() }) },
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
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (val phase = state.phase) {
                InboxPhase.Loading -> LoadingState()
                is InboxPhase.Failed -> ErrorState(phase.error, onRetry = onRetry)
                InboxPhase.Ready -> if (state.isEmpty) ConversationsEmptyState() else ConversationList(state.rows, onOpen)
            }
        }
        Surface(color = colors.surface, shadowElevation = 4.dp) {
            Button(
                onClick = onNew,
                colors = ButtonDefaults.buttonColors(containerColor = colors.accent, contentColor = colors.onAccent),
                modifier = Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                Icon(Icons.Filled.Add, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.clayver_new_conversation))
            }
        }
    }
}

@Composable
private fun ConversationsEmptyState() {
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
        Text(stringResource(R.string.clayver_conversations_empty), color = colors.secondaryText, textAlign = TextAlign.Center)
    }
}

@Composable
private fun ConversationList(rows: List<ConversationListRow>, onOpen: (String) -> Unit) {
    val now = rememberNow()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 4.dp)) {
        items(rows, key = { it.conversationId }) { row ->
            ConversationRowView(row, now, onClick = { onOpen(row.conversationId) })
            HorizontalDivider(color = LocalClayverColors.current.divider)
        }
    }
}

@Composable
private fun conversationPreviewText(preview: ConversationPreview?): String {
    val body = when (preview) {
        null -> return stringResource(R.string.clayver_conversation_no_messages)
        is ConversationPreview.Text -> preview.text
        is ConversationPreview.Attachment -> stringResource(R.string.clayver_conversation_attachment)
    }
    return if (preview.fromCustomer) stringResource(R.string.clayver_conversation_preview_you, body) else body
}

@Composable
private fun ConversationRowView(row: ConversationListRow, now: Long, onClick: () -> Unit) {
    val colors = LocalClayverColors.current
    val preview = conversationPreviewText(row.preview)
    val time = relativeTimeText(remember(row.time, now) { AgentInboxFormatting.relativeTime(row.time, now) })
    val unread = row.unread > 0
    val unreadText = if (unread) stringResource(R.string.clayver_conversation_unread, row.unread) else null
    val description = listOfNotNull(preview, time, unreadText).joinToString(". ")
    val openLabel = stringResource(R.string.clayver_open_conversation)

    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClickLabel = openLabel, role = Role.Button, onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = description
                if (unread) stateDescription = unreadText.orEmpty()
            }
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                preview,
                color = colors.onSurface,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (unread) FontWeight.Bold else FontWeight.Normal,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(4.dp))
            Text(time, color = colors.secondaryText, style = MaterialTheme.typography.labelSmall)
        }
        if (unread) {
            Spacer(Modifier.width(8.dp))
            Badge(containerColor = colors.accent, contentColor = colors.onAccent) {
                Text(if (row.unread > 99) "99+" else row.unread.toString())
            }
        }
    }
}

// endregion
