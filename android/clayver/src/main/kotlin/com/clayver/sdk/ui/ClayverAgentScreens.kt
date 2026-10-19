package com.clayver.sdk.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.clayver.sdk.Clayver
import com.clayver.sdk.ClayverBlockReason
import com.clayver.sdk.ClayverBlockStatus
import com.clayver.sdk.ClayverConversationStatus
import com.clayver.sdk.ClayverCustomerProfile
import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverException
import com.clayver.sdk.ClayverMessage
import com.clayver.sdk.ClayverNote
import com.clayver.sdk.ClayverSenderType
import com.clayver.sdk.ClayverTag
import com.clayver.sdk.ClayverTriageOption
import com.clayver.sdk.R
import com.clayver.sdk.internal.TagRules
import com.clayver.sdk.internal.PushDestination
import com.clayver.sdk.notifications.ClayverNotifications
import kotlinx.coroutines.delay
import java.text.DateFormat
import java.util.Date

/**
 * Agent mode: the workspace's conversations (Open / Closed) for support staff
 * signed into the host app. Tapping a row opens the agent conversation view
 * inside this composable, unless [onOpenConversation] is set. Users without an
 * agent role see a "no access" message.
 *
 * @param initialConversationId opens this conversation on top of the inbox (e.g. from a push).
 * @param onClose shows a close button in the toolbar when set.
 * @param onOpenConversation handle navigation yourself (e.g. with your NavHost)
 *   and show [ClayverAgentConversationScreen] for the id.
 */
@Composable
public fun ClayverAgentInboxScreen(
    modifier: Modifier = Modifier,
    initialConversationId: String? = null,
    theme: ClayverTheme = Clayver.theme,
    onClose: (() -> Unit)? = null,
    onOpenConversation: ((conversationId: String) -> Unit)? = null,
) {
    var openId by rememberSaveable(initialConversationId) { mutableStateOf(initialConversationId) }
    val current = openId
    if (current != null && onOpenConversation == null) {
        BackHandler { openId = null }
        ClayverAgentConversationScreen(
            conversationId = current,
            modifier = modifier,
            theme = theme,
            onBack = { openId = null },
            onOpenConversation = { openId = it },
        )
        return
    }
    val vm: AgentInboxViewModel = viewModel(key = "clayver-agent-inbox", factory = AgentInboxViewModel.factory())
    val state by vm.state.collectAsStateWithLifecycle()
    ClayverThemeProvider(theme, workspaceAccent = null) {
        AgentInboxContent(
            state = state,
            vm = vm,
            onClose = onClose,
            onOpen = { id -> if (onOpenConversation != null) onOpenConversation(id) else openId = id },
            modifier = modifier,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AgentInboxContent(
    state: AgentInboxUiState,
    vm: AgentInboxViewModel,
    onClose: (() -> Unit)?,
    onOpen: (String) -> Unit,
    modifier: Modifier,
) {
    val colors = LocalClayverColors.current
    Column(modifier.fillMaxSize().background(colors.background)) {
        TopAppBar(
            title = { Text(stringResource(R.string.clayver_agent_inbox_title), modifier = Modifier.semantics { heading() }) },
            navigationIcon = {
                if (onClose != null) {
                    IconButton(onClick = onClose) {
                        Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.clayver_agent_close_inbox))
                    }
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = colors.surface,
                titleContentColor = colors.onSurface,
                navigationIconContentColor = colors.onSurface,
            ),
        )
        val tabs = listOf(ClayverConversationStatus.OPEN, ClayverConversationStatus.CLOSED)
        TabRow(
            selectedTabIndex = tabs.indexOf(state.tab),
            containerColor = colors.surface,
            contentColor = colors.accent,
        ) {
            tabs.forEach { status ->
                Tab(
                    selected = state.tab == status,
                    onClick = { vm.selectTab(status) },
                    text = { Text(stringResource(statusLabel(status))) },
                    selectedContentColor = colors.accent,
                    unselectedContentColor = colors.secondaryText,
                )
            }
        }
        if (state.tags.isNotEmpty()) TagFilterRow(state.tags, state.tagFilter, onSelect = vm::selectTag)
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (val phase = state.phase) {
                InboxPhase.Loading -> LoadingState()
                is InboxPhase.Failed -> AgentErrorState(phase.error, onRetry = vm::retry)
                InboxPhase.Ready -> if (state.isEmpty) InboxEmptyState(state.tab, state.tagFilter != null) else InboxList(state.rows, onOpen)
            }
        }
    }
}

private fun statusLabel(status: ClayverConversationStatus): Int = when (status) {
    ClayverConversationStatus.OPEN -> R.string.clayver_agent_tab_open
    ClayverConversationStatus.CLOSED -> R.string.clayver_agent_tab_closed
}

@Composable
private fun AgentErrorState(error: ClayverException, onRetry: () -> Unit) {
    if (error.code == ClayverErrorCode.PERMISSION_DENIED) {
        val colors = LocalClayverColors.current
        Column(
            Modifier.fillMaxSize().padding(32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                stringResource(R.string.clayver_agent_error_not_agent),
                color = colors.onSurface,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive },
            )
            Spacer(Modifier.height(16.dp))
            TextButton(onClick = onRetry) { Text(stringResource(R.string.clayver_retry)) }
        }
    } else {
        ErrorState(error, onRetry)
    }
}

/** "All" plus one chip per tag; selecting the current tag again shows all. */
@Composable
private fun TagFilterRow(tags: List<ClayverTag>, selected: String?, onSelect: (String?) -> Unit) {
    val colors = LocalClayverColors.current
    val chipColors = FilterChipDefaults.filterChipColors(
        selectedContainerColor = colors.accent.copy(alpha = 0.15f),
        selectedLabelColor = colors.onSurface,
        labelColor = colors.onSurface,
    )
    LazyRow(
        Modifier.fillMaxWidth().background(colors.surface),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item(key = "all") {
            FilterChip(
                selected = selected == null,
                onClick = { onSelect(null) },
                label = { Text(stringResource(R.string.clayver_agent_tag_filter_all)) },
                colors = chipColors,
            )
        }
        items(tags, key = { it.id }) { tag ->
            FilterChip(
                selected = selected == tag.id,
                onClick = { onSelect(if (selected == tag.id) null else tag.id) },
                label = { Text(tag.name, maxLines = 1) },
                leadingIcon = { TagDot(tag.color) },
                colors = chipColors,
            )
        }
    }
}

@Composable
private fun InboxEmptyState(tab: ClayverConversationStatus, filtered: Boolean) {
    val colors = LocalClayverColors.current
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(
            stringResource(
                when {
                    filtered -> R.string.clayver_agent_empty_tag
                    tab == ClayverConversationStatus.OPEN -> R.string.clayver_agent_empty_open
                    else -> R.string.clayver_agent_empty_closed
                },
            ),
            color = colors.secondaryText,
            textAlign = TextAlign.Center,
        )
    }
}

/** Current time, refreshed every minute so relative times stay accurate. */
@Composable
internal fun rememberNow(): Long {
    val now by produceState(System.currentTimeMillis()) {
        while (true) {
            delay(60_000L)
            value = System.currentTimeMillis()
        }
    }
    return now
}

@Composable
private fun InboxList(rows: List<AgentInboxRow>, onOpen: (String) -> Unit) {
    val now = rememberNow()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 4.dp)) {
        items(rows, key = { it.conversationId }) { row ->
            InboxRowView(row, now, onClick = { onOpen(row.conversationId) })
            HorizontalDivider(color = LocalClayverColors.current.divider)
        }
    }
}

@Composable
internal fun customerNameText(name: CustomerName?): String = when (name) {
    is CustomerName.Named -> name.text
    is CustomerName.Anonymous -> stringResource(R.string.clayver_agent_customer_fallback, name.shortId)
    null -> stringResource(R.string.clayver_agent_customer)
}

@Composable
internal fun relativeTimeText(time: RelativeTime): String = when (time) {
    RelativeTime.JustNow -> stringResource(R.string.clayver_agent_time_now)
    is RelativeTime.Minutes -> stringResource(R.string.clayver_agent_time_minutes, time.count)
    is RelativeTime.Hours -> stringResource(R.string.clayver_agent_time_hours, time.count)
    RelativeTime.Yesterday -> stringResource(R.string.clayver_yesterday)
    is RelativeTime.Date -> time.text
}

@Composable
private fun previewText(preview: InboxPreview?): String {
    if (preview == null) return stringResource(R.string.clayver_agent_no_messages)
    val body = preview.text ?: if (preview.hasAttachment) stringResource(R.string.clayver_agent_preview_attachment) else ""
    return if (preview.senderType == ClayverSenderType.AGENT) stringResource(R.string.clayver_agent_preview_team, body) else body
}

@Composable
private fun InboxRowView(row: AgentInboxRow, now: Long, onClick: () -> Unit) {
    val colors = LocalClayverColors.current
    val name = customerNameText(row.customerName)
    val preview = previewText(row.preview)
    val time = relativeTimeText(remember(row.updatedAt, now) { AgentInboxFormatting.relativeTime(row.updatedAt, now) })
    val assigned = when (row.assignment) {
        Assignment.NONE -> null
        Assignment.ME -> stringResource(R.string.clayver_agent_assigned_to_me)
        Assignment.OTHER -> stringResource(R.string.clayver_agent_assigned_other)
    }
    val unreadText = if (row.unread > 0) stringResource(R.string.clayver_agent_unread_count, row.unread) else null
    val description = listOfNotNull(name, preview, time, unreadText, assigned).joinToString(". ")
    val openLabel = stringResource(R.string.clayver_agent_open_conversation)
    val unread = row.unread > 0

    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClickLabel = openLabel, role = Role.Button, onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = description
                if (unread) stateDescription = unreadText.orEmpty()
            }
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(40.dp).clip(CircleShape).background(colors.agentBubble),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                name.firstOrNull()?.uppercaseChar()?.toString() ?: "?",
                color = colors.onAgentBubble,
                style = MaterialTheme.typography.titleMedium,
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    name,
                    color = colors.onSurface,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = if (unread) FontWeight.Bold else FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (assigned != null) {
                    Spacer(Modifier.width(6.dp))
                    Icon(
                        Icons.Filled.Person,
                        contentDescription = null,
                        tint = if (row.assignment == Assignment.ME) colors.accent else colors.secondaryText,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
            Spacer(Modifier.height(2.dp))
            Text(
                preview,
                color = if (unread) colors.onSurface else colors.secondaryText,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (assigned != null) {
                Text(assigned, color = colors.secondaryText, style = MaterialTheme.typography.labelSmall, maxLines = 1)
            }
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(time, color = colors.secondaryText, style = MaterialTheme.typography.labelSmall)
            if (unread) {
                Spacer(Modifier.height(4.dp))
                Badge(containerColor = colors.accent, contentColor = colors.onAccent) {
                    Text(if (row.unread > 99) "99+" else row.unread.toString())
                }
            }
        }
    }
}

/**
 * Agent mode: one conversation from the team's side. Live messages, history,
 * replies with attachments and "Seen" from the customer's read marker. The ⋮
 * button opens the details sheet: customer profile, assignee, open/closed,
 * priority, status, tags, internal notes, the customer's other conversations
 * and blocking. While on screen it moves the team's read marker (`reads/{id}/agent`).
 *
 * @param onBack shows a back button in the toolbar when set.
 * @param onOpenConversation makes the customer's other conversations in the
 *   details sheet tappable; show [ClayverAgentConversationScreen] for the id.
 */
@Composable
public fun ClayverAgentConversationScreen(
    conversationId: String,
    modifier: Modifier = Modifier,
    theme: ClayverTheme = Clayver.theme,
    onBack: (() -> Unit)? = null,
    onOpenConversation: ((conversationId: String) -> Unit)? = null,
) {
    val vm: AgentConversationViewModel = viewModel(
        key = "clayver-agent-conversation:$conversationId",
        factory = AgentConversationViewModel.factory(conversationId),
    )
    val state by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LifecycleResumeEffect(vm) {
        vm.setVisible(true)
        ClayverNotifications.cancel(context, PushDestination.AgentConversation(conversationId))
        onPauseOrDispose { vm.setVisible(false) }
    }
    ClayverThemeProvider(theme, state.config?.accentColor) {
        AgentConversationContent(state, vm, onBack, onOpenConversation, modifier)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AgentConversationContent(
    state: AgentChatUiState,
    vm: AgentConversationViewModel,
    onBack: (() -> Unit)?,
    onOpenConversation: ((String) -> Unit)?,
    modifier: Modifier,
) {
    val colors = LocalClayverColors.current
    var showDetails by rememberSaveable { mutableStateOf(false) }
    var showTags by rememberSaveable { mutableStateOf(false) }
    val customerName = customerNameText(state.customerName)
    val statusText = stringResource(if (state.isClosed) R.string.clayver_agent_status_closed else R.string.clayver_agent_status_open)
    val assignmentText = when (state.assignment) {
        Assignment.NONE -> stringResource(R.string.clayver_agent_unassigned)
        Assignment.ME -> stringResource(R.string.clayver_agent_assigned_to_me)
        Assignment.OTHER -> stringResource(R.string.clayver_agent_assigned_other)
    }
    val ready = state.conversation != null && state.action == null

    Column(modifier.fillMaxSize().background(colors.background)) {
        TopAppBar(
            title = {
                Column(Modifier.semantics(mergeDescendants = true) { heading() }) {
                    Text(customerName, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        "$statusText · $assignmentText",
                        style = MaterialTheme.typography.labelMedium,
                        color = colors.secondaryText,
                        maxLines = 1,
                    )
                }
            },
            navigationIcon = {
                if (onBack != null) {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.clayver_agent_back))
                    }
                }
            },
            actions = {
                IconButton(onClick = { showDetails = true }, enabled = state.conversation != null) {
                    Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.clayver_agent_details))
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = colors.surface,
                titleContentColor = colors.onSurface,
                navigationIconContentColor = colors.onSurface,
                actionIconContentColor = colors.onSurface,
            ),
        )
        TagChipsRow(
            tags = state.tags,
            enabled = state.conversation != null,
            onEdit = { showTags = true },
            priority = state.priority,
            stage = state.stage,
            onTriage = { showDetails = true },
        )
        if (state.isClosed) ClosedBanner(enabled = ready, onReopen = vm::toggleStatus)
        state.actionError?.let { ActionErrorBanner(it, onDismiss = vm::dismissActionError) }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (val phase = state.phase) {
                ChatPhase.Loading -> LoadingState()
                is ChatPhase.Failed -> AgentErrorState(phase.error, onRetry = vm::retry)
                ChatPhase.Ready ->
                    if (state.items.isEmpty()) {
                        Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                            Text(stringResource(R.string.clayver_agent_no_messages), color = colors.secondaryText)
                        }
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
                            perspective = ChatPerspective.AGENT,
                            senderLabel = { agentSideLabel(it, state.myUid, customerName) },
                        )
                    }
            }
        }
        if (state.phase !is ChatPhase.Failed) {
            Composer(
                model = ComposerModel(state.draft, state.pendingAttachment, state.composerError, state.canSend),
                actions = vm,
                enabled = state.phase == ChatPhase.Ready,
                hint = stringResource(R.string.clayver_agent_composer_hint),
            )
        }
    }
    if (showDetails) {
        ModalBottomSheet(
            onDismissRequest = { showDetails = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            // A tall sheet would otherwise slide under the status bar (edge-to-edge).
            modifier = Modifier.statusBarsPadding(),
            containerColor = colors.surface,
        ) {
            DetailsSheet(
                state = state,
                customerName = customerName,
                ready = ready,
                vm = vm,
                onEditTags = {
                    showDetails = false
                    showTags = true
                },
                onOpenConversation = onOpenConversation?.let { open ->
                    { id: String ->
                        showDetails = false
                        open(id)
                    }
                },
            )
        }
    }
    if (showTags) {
        ModalBottomSheet(
            onDismissRequest = { showTags = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            // A tall sheet would otherwise slide under the status bar (edge-to-edge).
            modifier = Modifier.statusBarsPadding(),
            containerColor = colors.surface,
        ) {
            TagSheet(state, onToggle = vm::toggleTag, onCreate = vm::createTag)
        }
    }
}

// region tags

/** `#rrggbb` as a Compose color; malformed values fall back to the neutral palette color. */
private fun tagColor(hex: String): Color =
    Color(ChatFormatting.parseHexColor(hex) ?: ChatFormatting.parseHexColor(TagRules.PALETTE[3])!!)

@Composable
private fun TagDot(hex: String) {
    Box(Modifier.size(10.dp).clip(CircleShape).background(tagColor(hex)))
}

/**
 * The conversation's priority and status (when set; they open the details
 * sheet) and its tags as colored chips (they open the tag sheet). Tags are
 * added from the details sheet; nothing is shown when there is nothing set.
 */
@Composable
private fun TagChipsRow(
    tags: List<ClayverTag>,
    enabled: Boolean,
    onEdit: () -> Unit,
    priority: ClayverTriageOption? = null,
    stage: ClayverTriageOption? = null,
    onTriage: () -> Unit = {},
) {
    if (tags.isEmpty() && priority == null && stage == null) return
    val colors = LocalClayverColors.current
    val editLabel = stringResource(R.string.clayver_agent_edit_tags)
    val detailsLabel = stringResource(R.string.clayver_agent_details)
    val priorityLabel = stringResource(R.string.clayver_agent_priority)
    val stageLabel = stringResource(R.string.clayver_agent_stage)
    Row(
        Modifier
            .fillMaxWidth()
            .background(colors.surface)
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        listOfNotNull(priority?.let { priorityLabel to it }, stage?.let { stageLabel to it }).forEach { (label, option) ->
            Row(
                Modifier
                    .clip(RoundedCornerShape(50))
                    .background(tagColor(option.color).copy(alpha = 0.15f))
                    .clickable(enabled = enabled, onClickLabel = detailsLabel, role = Role.Button, onClick = onTriage)
                    .semantics(mergeDescendants = true) { contentDescription = "$label: ${option.name}" }
                    .padding(horizontal = 10.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TagDot(option.color)
                Spacer(Modifier.width(6.dp))
                Text(
                    option.name,
                    color = colors.onSurface,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                )
            }
        }
        tags.forEach { tag ->
            val color = tagColor(tag.color)
            Row(
                Modifier
                    .clip(RoundedCornerShape(50))
                    .background(color.copy(alpha = 0.15f))
                    .clickable(enabled = enabled, onClickLabel = editLabel, role = Role.Button, onClick = onEdit)
                    .padding(horizontal = 10.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TagDot(tag.color)
                Spacer(Modifier.width(6.dp))
                Text(tag.name, color = colors.onSurface, style = MaterialTheme.typography.labelMedium, maxLines = 1)
            }
        }
    }
}

/** The "Add tag" sheet: search, toggle catalog tags, create a tag from the search text. */
@Composable
private fun TagSheet(state: AgentChatUiState, onToggle: (String) -> Unit, onCreate: (String) -> Unit) {
    val colors = LocalClayverColors.current
    var query by rememberSaveable { mutableStateOf("") }
    val rows = remember(state.tagCatalog, state.tagIds, query) { TagPicker.rows(state.tagCatalog, state.tagIds, query) }
    val candidate = remember(state.tagCatalog, query) { TagPicker.createCandidate(state.tagCatalog, query) }
    Column(Modifier.fillMaxWidth().navigationBarsPadding().imePadding().padding(bottom = 16.dp)) {
        Text(
            stringResource(R.string.clayver_agent_tags),
            style = MaterialTheme.typography.titleLarge,
            color = colors.onSurface,
            modifier = Modifier.padding(horizontal = 24.dp).semantics { heading() },
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text(stringResource(R.string.clayver_agent_tag_search)) },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        Spacer(Modifier.height(8.dp))
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp)) {
            if (candidate != null) {
                item(key = "create") {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable(enabled = !state.creatingTag, role = Role.Button) {
                                onCreate(candidate)
                                query = ""
                            }
                            .padding(horizontal = 24.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.Add, contentDescription = null, tint = colors.accent, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(12.dp))
                        Text(
                            stringResource(R.string.clayver_agent_create_tag, candidate),
                            color = colors.accent,
                            style = MaterialTheme.typography.bodyLarge,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
            items(rows, key = { it.tag.id }) { row ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .toggleable(value = row.selected, role = Role.Checkbox, onValueChange = { onToggle(row.tag.id) })
                        .padding(horizontal = 24.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TagDot(row.tag.color)
                    Spacer(Modifier.width(12.dp))
                    Text(
                        row.tag.name,
                        color = colors.onSurface,
                        style = MaterialTheme.typography.bodyLarge,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    Checkbox(checked = row.selected, onCheckedChange = null)
                }
            }
            if (rows.isEmpty() && candidate == null) {
                item(key = "empty") {
                    Text(
                        stringResource(
                            if (state.tagCatalog.isEmpty()) R.string.clayver_agent_no_tags else R.string.clayver_agent_no_matching_tags,
                        ),
                        color = colors.secondaryText,
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 16.dp),
                    )
                }
            }
        }
    }
}

// endregion

/** Sender labels in the agent view. */
@Composable
private fun agentSideLabel(message: ClayverMessage, myUid: String?, customerName: String): String = when (message.senderType) {
    ClayverSenderType.CUSTOMER -> customerName
    ClayverSenderType.SYSTEM -> stringResource(R.string.clayver_system)
    ClayverSenderType.AGENT ->
        if (myUid != null && message.senderId == myUid) {
            stringResource(R.string.clayver_you)
        } else {
            message.senderName?.takeIf { it.isNotBlank() } ?: stringResource(R.string.clayver_agent_teammate)
        }
}

@Composable
private fun ClosedBanner(enabled: Boolean, onReopen: () -> Unit) {
    val colors = LocalClayverColors.current
    Surface(color = colors.agentBubble, contentColor = colors.onAgentBubble) {
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(R.string.clayver_agent_closed_banner),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f).padding(vertical = 12.dp),
            )
            TextButton(onClick = onReopen, enabled = enabled) { Text(stringResource(R.string.clayver_agent_reopen)) }
        }
    }
}

@Composable
private fun ActionErrorBanner(error: ClayverException, onDismiss: () -> Unit) {
    val colors = LocalClayverColors.current
    Row(
        Modifier.fillMaxWidth().background(colors.surface).padding(start = 16.dp, end = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            if (error.code == ClayverErrorCode.PERMISSION_DENIED) {
                stringResource(R.string.clayver_agent_error_not_agent)
            } else {
                errorMessage(error)
            },
            color = colors.error,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.weight(1f).padding(vertical = 8.dp).semantics { liveRegion = LiveRegionMode.Polite },
        )
        TextButton(onClick = onDismiss) { Text(stringResource(R.string.clayver_agent_dismiss)) }
    }
}

// region details sheet

/** Block durations offered in the details sheet; null blocks until an agent unblocks. */
private val BLOCK_DURATIONS: List<Pair<Int, Long?>> = listOf(
    R.string.clayver_agent_block_1h to 3_600_000L,
    R.string.clayver_agent_block_24h to 86_400_000L,
    R.string.clayver_agent_block_7d to 7 * 86_400_000L,
    R.string.clayver_agent_block_30d to 30 * 86_400_000L,
    R.string.clayver_agent_block_forever to null,
)

/** Reasons an agent may pick (`rate_limit` is set by the functions only). */
private val AGENT_BLOCK_REASONS: List<ClayverBlockReason> =
    listOf(ClayverBlockReason.SPAM, ClayverBlockReason.ABUSE, ClayverBlockReason.OTHER)

private fun blockReasonLabel(reason: ClayverBlockReason): Int = when (reason) {
    ClayverBlockReason.SPAM -> R.string.clayver_agent_block_reason_spam
    ClayverBlockReason.ABUSE -> R.string.clayver_agent_block_reason_abuse
    ClayverBlockReason.RATE_LIMIT -> R.string.clayver_agent_block_reason_rate_limit
    ClayverBlockReason.OTHER -> R.string.clayver_agent_block_reason_other
}

/**
 * The ⋮ sheet: customer, conversation (assignee, open/closed, priority,
 * status, tags), internal notes, the customer's conversations and blocking.
 */
@Composable
private fun DetailsSheet(
    state: AgentChatUiState,
    customerName: String,
    ready: Boolean,
    vm: AgentConversationViewModel,
    onEditTags: () -> Unit,
    onOpenConversation: ((String) -> Unit)?,
) {
    val colors = LocalClayverColors.current
    Column(
        Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp)
            .padding(bottom = 24.dp),
    ) {
        Text(
            stringResource(R.string.clayver_agent_details),
            style = MaterialTheme.typography.titleLarge,
            color = colors.onSurface,
            modifier = Modifier.semantics { heading() },
        )

        SectionHeader(stringResource(R.string.clayver_agent_section_customer))
        CustomerSection(customerName, state.conversation?.customerId, state.profile)

        SectionHeader(stringResource(R.string.clayver_agent_section_conversation))
        ConversationSection(state, ready, vm, onEditTags)

        SectionHeader(stringResource(R.string.clayver_agent_section_notes))
        NotesSection(state, vm)

        SectionHeader(stringResource(R.string.clayver_agent_section_conversations))
        CustomerConversationsSection(state, onOpenConversation)

        SectionHeader(stringResource(R.string.clayver_agent_section_block))
        BlockSection(state.block, enabled = state.conversation != null && !state.blockBusy, vm)
    }
}

@Composable
private fun SectionHeader(text: String) {
    val colors = LocalClayverColors.current
    Spacer(Modifier.height(20.dp))
    HorizontalDivider(color = colors.divider)
    Spacer(Modifier.height(12.dp))
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        color = colors.onSurface,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.semantics { heading() },
    )
    Spacer(Modifier.height(4.dp))
}

/** A label and value with an optional text button at the end. */
@Composable
private fun ActionRow(label: String, value: String, action: String?, enabled: Boolean, onAction: () -> Unit) {
    val colors = LocalClayverColors.current
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = colors.secondaryText)
            Text(value, style = MaterialTheme.typography.bodyLarge, color = colors.onSurface)
        }
        if (action != null) TextButton(onClick = onAction, enabled = enabled) { Text(action) }
    }
}

@Composable
private fun ConversationSection(
    state: AgentChatUiState,
    ready: Boolean,
    vm: AgentConversationViewModel,
    onEditTags: () -> Unit,
) {
    val colors = LocalClayverColors.current
    val assignee = when (state.assignment) {
        Assignment.NONE -> stringResource(R.string.clayver_agent_unassigned)
        Assignment.ME -> stringResource(R.string.clayver_you)
        Assignment.OTHER -> state.assigneeName ?: stringResource(R.string.clayver_agent_assignee_teammate)
    }
    ActionRow(
        label = stringResource(R.string.clayver_agent_assignee),
        value = assignee,
        action = stringResource(if (state.assignment == Assignment.ME) R.string.clayver_agent_unassign else R.string.clayver_agent_assign_to_me),
        enabled = ready,
        onAction = { vm.assign(toMe = state.assignment != Assignment.ME) },
    )
    ActionRow(
        label = stringResource(R.string.clayver_agent_conversation_state),
        value = stringResource(if (state.isClosed) R.string.clayver_agent_status_closed else R.string.clayver_agent_status_open),
        action = stringResource(if (state.isClosed) R.string.clayver_agent_reopen else R.string.clayver_agent_close_conversation),
        enabled = ready,
        onAction = vm::toggleStatus,
    )
    TriagePicker(
        label = stringResource(R.string.clayver_agent_priority),
        options = state.triageOptions.priority,
        selected = state.priority,
        enabled = state.conversation != null,
        onSelect = vm::setPriority,
    )
    TriagePicker(
        label = stringResource(R.string.clayver_agent_stage),
        options = state.triageOptions.stage,
        selected = state.stage,
        enabled = state.conversation != null,
        onSelect = vm::setStage,
    )
    Spacer(Modifier.height(4.dp))
    Text(stringResource(R.string.clayver_agent_tags), style = MaterialTheme.typography.labelMedium, color = colors.secondaryText)
    TagChipsRow(state.tags, enabled = state.conversation != null, onEdit = onEditTags)
}

/** "None" plus the workspace's options, each with its colored dot. */
@Composable
private fun TriagePicker(
    label: String,
    options: List<ClayverTriageOption>,
    selected: ClayverTriageOption?,
    enabled: Boolean,
    onSelect: (String?) -> Unit,
) {
    val colors = LocalClayverColors.current
    var expanded by remember { mutableStateOf(false) }
    val none = stringResource(R.string.clayver_agent_triage_none)
    Box {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .clickable(enabled = enabled, onClickLabel = label, role = Role.DropdownList) { expanded = true }
                .padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(label, style = MaterialTheme.typography.labelMedium, color = colors.secondaryText)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (selected != null) {
                        TagDot(selected.color)
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(
                        selected?.name ?: none,
                        style = MaterialTheme.typography.bodyLarge,
                        color = if (selected != null) colors.onSurface else colors.secondaryText,
                    )
                }
            }
            Icon(Icons.Filled.ArrowDropDown, contentDescription = null, tint = colors.secondaryText)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            DropdownMenuItem(
                text = { Text(none) },
                onClick = {
                    expanded = false
                    onSelect(null)
                },
                trailingIcon = { if (selected == null) Icon(Icons.Filled.Check, contentDescription = null) },
            )
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option.name) },
                    leadingIcon = { TagDot(option.color) },
                    onClick = {
                        expanded = false
                        onSelect(option.id)
                    },
                    trailingIcon = { if (selected?.id == option.id) Icon(Icons.Filled.Check, contentDescription = null) },
                )
            }
        }
    }
}

@Composable
private fun NotesSection(state: AgentChatUiState, vm: AgentConversationViewModel) {
    val colors = LocalClayverColors.current
    val now = rememberNow()
    Text(
        stringResource(R.string.clayver_agent_notes_hint),
        style = MaterialTheme.typography.bodySmall,
        color = colors.secondaryText,
    )
    Spacer(Modifier.height(8.dp))
    OutlinedTextField(
        value = state.noteDraft,
        onValueChange = vm::onNoteDraftChange,
        placeholder = { Text(stringResource(R.string.clayver_agent_note_placeholder)) },
        minLines = 2,
        maxLines = 6,
        enabled = state.conversation != null,
        modifier = Modifier.fillMaxWidth(),
    )
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        TextButton(onClick = vm::addNote, enabled = state.noteDraft.isNotBlank() && !state.addingNote) {
            Text(stringResource(R.string.clayver_agent_add_note))
        }
    }
    val notes = state.visibleNotes
    if (notes.isEmpty()) {
        Text(stringResource(R.string.clayver_agent_no_notes), style = MaterialTheme.typography.bodyMedium, color = colors.secondaryText)
    }
    notes.forEach { note -> NoteRow(note, now, isMine = note.authorUid == state.myUid, canDelete = state.canDelete(note), onDelete = { vm.deleteNote(note.id) }) }
}

@Composable
private fun NoteRow(note: ClayverNote, now: Long, isMine: Boolean, canDelete: Boolean, onDelete: () -> Unit) {
    val colors = LocalClayverColors.current
    val author = if (isMine) stringResource(R.string.clayver_you) else note.authorName ?: stringResource(R.string.clayver_agent_teammate)
    val time = relativeTimeText(remember(note.createdAt, now) { AgentInboxFormatting.relativeTime(note.createdAt, now) })
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(colors.agentBubble.copy(alpha = 0.5f))
            .padding(start = 12.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.weight(1f).padding(end = if (canDelete) 0.dp else 12.dp).semantics(mergeDescendants = true) {}) {
            Text("$author · $time", style = MaterialTheme.typography.labelMedium, color = colors.secondaryText)
            Spacer(Modifier.height(2.dp))
            Text(note.text, style = MaterialTheme.typography.bodyMedium, color = colors.onSurface)
        }
        if (canDelete) {
            IconButton(onClick = onDelete) {
                Icon(
                    Icons.Filled.Delete,
                    contentDescription = stringResource(R.string.clayver_agent_delete_note),
                    tint = colors.secondaryText,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
    }
}

@Composable
private fun CustomerConversationsSection(state: AgentChatUiState, onOpenConversation: ((String) -> Unit)?) {
    val colors = LocalClayverColors.current
    val now = rememberNow()
    val list = state.customerConversations.ifEmpty { listOfNotNull(state.conversation) }
    if (list.isEmpty()) {
        Text(stringResource(R.string.clayver_agent_no_messages), style = MaterialTheme.typography.bodyMedium, color = colors.secondaryText)
        return
    }
    val openLabel = stringResource(R.string.clayver_agent_open_conversation)
    list.forEach { conversation ->
        val current = conversation.id == state.conversationId
        val row = AgentInboxFormatting.row(conversation, state.profile, state.myUid)
        val preview = previewText(row.preview)
        val status = stringResource(
            if (conversation.status == ClayverConversationStatus.CLOSED) R.string.clayver_agent_status_closed else R.string.clayver_agent_status_open,
        )
        val time = relativeTimeText(remember(row.updatedAt, now) { AgentInboxFormatting.relativeTime(row.updatedAt, now) })
        val meta = if (current) "${stringResource(R.string.clayver_agent_this_conversation)} · $status" else "$status · $time"
        val clickable = !current && onOpenConversation != null
        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .then(
                    if (clickable) {
                        Modifier.clickable(onClickLabel = openLabel, role = Role.Button) { onOpenConversation?.invoke(conversation.id) }
                    } else {
                        Modifier
                    },
                )
                .background(if (current) colors.accent.copy(alpha = 0.08f) else Color.Transparent)
                .semantics(mergeDescendants = true) {}
                .padding(horizontal = 8.dp, vertical = 8.dp),
        ) {
            Text(
                preview,
                style = MaterialTheme.typography.bodyMedium,
                color = colors.onSurface,
                fontWeight = if (current) FontWeight.Medium else FontWeight.Normal,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(meta, style = MaterialTheme.typography.labelSmall, color = colors.secondaryText, maxLines = 1)
        }
    }
}

@Composable
private fun BlockSection(block: ClayverBlockStatus?, enabled: Boolean, vm: AgentConversationViewModel) {
    val colors = LocalClayverColors.current
    if (block != null) {
        val reason = stringResource(blockReasonLabel(block.reason))
        val until = block.until?.let { at ->
            remember(at) { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(at)) }
        }
        ActionRow(
            label = stringResource(R.string.clayver_agent_block_status),
            value = if (until != null) {
                stringResource(R.string.clayver_agent_blocked_until, reason, until)
            } else {
                stringResource(R.string.clayver_agent_blocked_forever, reason)
            },
            action = stringResource(R.string.clayver_agent_unblock),
            enabled = enabled,
            onAction = vm::unblockCustomer,
        )
        return
    }
    var reasonWire by rememberSaveable { mutableStateOf(ClayverBlockReason.SPAM.wireValue) }
    var durationIndex by rememberSaveable { mutableStateOf(1) }
    val chipColors = FilterChipDefaults.filterChipColors(
        selectedContainerColor = colors.accent.copy(alpha = 0.15f),
        selectedLabelColor = colors.onSurface,
        labelColor = colors.onSurface,
    )
    Text(stringResource(R.string.clayver_agent_block_hint), style = MaterialTheme.typography.bodySmall, color = colors.secondaryText)
    Spacer(Modifier.height(8.dp))
    Text(stringResource(R.string.clayver_agent_block_reason), style = MaterialTheme.typography.labelMedium, color = colors.secondaryText)
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        AGENT_BLOCK_REASONS.forEach { reason ->
            FilterChip(
                selected = reasonWire == reason.wireValue,
                onClick = { reasonWire = reason.wireValue },
                label = { Text(stringResource(blockReasonLabel(reason))) },
                colors = chipColors,
            )
        }
    }
    Text(stringResource(R.string.clayver_agent_block_duration), style = MaterialTheme.typography.labelMedium, color = colors.secondaryText)
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        BLOCK_DURATIONS.forEachIndexed { index, (label, _) ->
            FilterChip(
                selected = durationIndex == index,
                onClick = { durationIndex = index },
                label = { Text(stringResource(label)) },
                colors = chipColors,
            )
        }
    }
    Spacer(Modifier.height(8.dp))
    Button(
        onClick = {
            vm.blockCustomer(
                ClayverBlockReason.fromWire(reasonWire),
                BLOCK_DURATIONS.getOrNull(durationIndex)?.second,
            )
        },
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(containerColor = colors.error, contentColor = Color.White),
    ) {
        Text(stringResource(R.string.clayver_agent_block_customer))
    }
}

// endregion

/** Customer name, email, account, id, last seen and custom properties. */
@Composable
private fun CustomerSection(name: String, customerId: String?, profile: ClayverCustomerProfile?) {
    val colors = LocalClayverColors.current
    val lastSeen = profile?.lastSeenAt?.let { at ->
        remember(at) { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(at)) }
    }
    val extra = profile?.customProperties.orEmpty().toSortedMap()
    Column(Modifier.fillMaxWidth()) {
        Text(name, style = MaterialTheme.typography.titleMedium, color = colors.onSurface)
        Spacer(Modifier.height(4.dp))
        InfoRow(stringResource(R.string.clayver_agent_info_email), profile?.email)
        InfoRow(
            stringResource(R.string.clayver_agent_info_account),
            profile?.account?.let { account ->
                stringResource(
                    when {
                        account.anonymous -> R.string.clayver_agent_info_account_anonymous
                        account.emailVerified -> R.string.clayver_agent_info_account_verified
                        else -> R.string.clayver_agent_info_account_signed_in
                    },
                )
            },
        )
        InfoRow(stringResource(R.string.clayver_agent_info_user_id), profile?.userId)
        InfoRow(stringResource(R.string.clayver_agent_info_customer_id), customerId)
        InfoRow(stringResource(R.string.clayver_agent_info_last_seen), lastSeen)
        if (extra.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text(
                stringResource(R.string.clayver_agent_info_properties),
                style = MaterialTheme.typography.labelLarge,
                color = colors.onSurface,
                modifier = Modifier.semantics { heading() },
            )
            extra.forEach { (key, value) -> InfoRow(key, formatProperty(value)) }
        }
    }
}

private fun formatProperty(value: Any): String = when (value) {
    is Double -> if (value % 1.0 == 0.0 && kotlin.math.abs(value) < 1e15) value.toLong().toString() else value.toString()
    else -> value.toString()
}

@Composable
private fun InfoRow(label: String, value: String?) {
    if (value.isNullOrBlank()) return
    val colors = LocalClayverColors.current
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp).semantics(mergeDescendants = true) {}) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = colors.secondaryText)
        Text(value, style = MaterialTheme.typography.bodyLarge, color = colors.onSurface)
    }
}
