package com.clayver.sdk.ui

import com.clayver.sdk.ClayverAgentConversation
import com.clayver.sdk.ClayverConversationStatus
import com.clayver.sdk.ClayverCustomerProfile
import com.clayver.sdk.ClayverException
import com.clayver.sdk.ClayverSenderType
import com.clayver.sdk.ClayverTag
import com.clayver.sdk.internal.AgentRules
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

// region models

/** How a customer is labelled in agent views. */
internal sealed interface CustomerName {
    /** `properties.name`, else the account's name or email. */
    data class Named(val text: String) : CustomerName

    /** No name known: "Customer {shortId}". */
    data class Anonymous(val shortId: String) : CustomerName
}

internal enum class Assignment { NONE, ME, OTHER }

internal data class InboxPreview(
    val text: String?,
    val hasAttachment: Boolean,
    val senderType: ClayverSenderType?,
)

internal data class AgentInboxRow(
    val conversationId: String,
    val customerId: String,
    val customerName: CustomerName,
    val preview: InboxPreview?,
    val updatedAt: Long,
    val unread: Int,
    val assignment: Assignment,
    val status: ClayverConversationStatus,
)

internal sealed interface RelativeTime {
    data object JustNow : RelativeTime
    data class Minutes(val count: Int) : RelativeTime
    data class Hours(val count: Int) : RelativeTime
    data object Yesterday : RelativeTime
    data class Date(val text: String) : RelativeTime
}

internal sealed interface InboxPhase {
    data object Loading : InboxPhase
    data object Ready : InboxPhase
    data class Failed(val error: ClayverException) : InboxPhase
}

internal data class AgentInboxUiState(
    val tab: ClayverConversationStatus = ClayverConversationStatus.OPEN,
    val phase: InboxPhase = InboxPhase.Loading,
    val rows: List<AgentInboxRow> = emptyList(),
    /** The tag catalog for the filter row (empty until loaded, or when the workspace has none). */
    val tags: List<ClayverTag> = emptyList(),
    /** Only conversations with this tag; null shows all. */
    val tagFilter: String? = null,
) {
    val isEmpty: Boolean get() = phase == InboxPhase.Ready && rows.isEmpty()
}

// endregion

internal object AgentInboxFormatting {

    fun customerName(customerId: String, profile: ClayverCustomerProfile?): CustomerName {
        profile?.name?.let { return CustomerName.Named(it.trim()) }
        profile?.account?.displayName?.let { return CustomerName.Named(it) }
        profile?.account?.email?.let { return CustomerName.Named(it) }
        return CustomerName.Anonymous(AgentRules.shortCustomerId(customerId))
    }

    fun assignment(assigneeUid: String?, myUid: String?): Assignment = when {
        assigneeUid == null -> Assignment.NONE
        myUid != null && assigneeUid == myUid -> Assignment.ME
        else -> Assignment.OTHER
    }

    fun row(conversation: ClayverAgentConversation, profile: ClayverCustomerProfile?, myUid: String?): AgentInboxRow =
        AgentInboxRow(
            conversationId = conversation.id,
            customerId = conversation.customerId,
            customerName = customerName(conversation.customerId, profile),
            preview = conversation.lastMessage?.let {
                InboxPreview(it.text?.replace('\n', ' ')?.trim()?.takeIf(String::isNotEmpty), it.hasAttachment, it.senderType)
            },
            updatedAt = conversation.updatedAt,
            unread = conversation.unreadForAgents,
            assignment = assignment(conversation.assigneeUid, myUid),
            status = conversation.status,
        )

    /** Newest activity first; ties broken by id (push ids are chronological) so the order is stable. */
    fun rows(
        conversations: List<ClayverAgentConversation>,
        profiles: Map<String, ClayverCustomerProfile>,
        myUid: String?,
    ): List<AgentInboxRow> =
        conversations
            .distinctBy { it.id }
            .sortedWith(compareByDescending<ClayverAgentConversation> { it.updatedAt }.thenByDescending { it.id })
            .map { row(it, profiles[it.customerId], myUid) }

    /** "now", "5 min", "3 h" (same day), "Yesterday", else a short date. */
    fun relativeTime(
        then: Long,
        now: Long,
        timeZone: TimeZone = TimeZone.getDefault(),
        locale: Locale = Locale.getDefault(),
    ): RelativeTime {
        val diff = (now - then).coerceAtLeast(0)
        val today = ChatFormatting.startOfDay(now, timeZone)
        val day = ChatFormatting.startOfDay(then, timeZone)
        val yesterday = Calendar.getInstance(timeZone).run {
            timeInMillis = today
            add(Calendar.DAY_OF_YEAR, -1)
            timeInMillis
        }
        return when {
            diff < 60_000L -> RelativeTime.JustNow
            diff < 3_600_000L -> RelativeTime.Minutes((diff / 60_000L).toInt())
            day == today -> RelativeTime.Hours((diff / 3_600_000L).toInt())
            day == yesterday -> RelativeTime.Yesterday
            else -> RelativeTime.Date(
                DateFormat.getDateInstance(DateFormat.SHORT, locale).apply { this.timeZone = timeZone }.format(Date(then)),
            )
        }
    }
}

/**
 * The agent inbox's state machine (Open/Closed tabs, tag filter, customer
 * names), free of Android and Firebase types. All methods must be called from
 * [scope]'s thread.
 */
internal class AgentInboxController(
    private val repository: AgentRepository,
    private val scope: CoroutineScope,
    private val limit: Int = DEFAULT_LIMIT,
) {
    private val _state = MutableStateFlow(AgentInboxUiState())
    val state: StateFlow<AgentInboxUiState> = _state.asStateFlow()

    private var conversations: List<ClayverAgentConversation> = emptyList()
    private val profiles = HashMap<String, ClayverCustomerProfile>()
    private val profileJobs = HashMap<String, Job>()
    private var myUid: String? = null
    private var sessionJob: Job? = null

    init {
        start()
        scope.launch {
            try {
                repository.tags().collect { tags ->
                    _state.update { it.copy(tags = tags) }
                    // A deleted tag can't stay selected.
                    val filter = _state.value.tagFilter
                    if (filter != null && tags.none { it.id == filter }) selectTag(null)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                // Best effort: without the catalog there is no filter row.
            }
        }
    }

    fun selectTab(status: ClayverConversationStatus) {
        if (status == _state.value.tab) return
        _state.update { it.copy(tab = status) }
        start()
    }

    /** Filters by [tagId], or shows every conversation for null. */
    fun selectTag(tagId: String?) {
        if (tagId == _state.value.tagFilter) return
        _state.update { it.copy(tagFilter = tagId) }
        start()
    }

    fun retry() = start()

    private fun start() {
        sessionJob?.cancel()
        profileJobs.clear() // children of the cancelled session
        conversations = emptyList()
        _state.update { it.copy(phase = InboxPhase.Loading, rows = emptyList()) }
        val tab = _state.value.tab
        val tagId = _state.value.tagFilter
        sessionJob = scope.launch {
            try {
                coroutineScope {
                    if (myUid == null) myUid = repository.currentUid()
                    repository.conversations(tab, limit, tagId).collect { list ->
                        conversations = list
                        syncProfiles(this)
                        _state.update { it.copy(phase = InboxPhase.Ready) }
                        publish()
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                _state.update { it.copy(phase = InboxPhase.Failed(e.toClayver())) }
            }
        }
    }

    /** One profile listener per customer on screen; names fall back to a short id until (or unless) it loads. */
    private fun syncProfiles(sessionScope: CoroutineScope) {
        val wanted = conversations.mapTo(HashSet()) { it.customerId }
        profileJobs.keys.filter { it !in wanted }.forEach { profileJobs.remove(it)?.cancel() }
        for (cid in wanted) {
            if (cid in profileJobs) continue
            profileJobs[cid] = sessionScope.launch {
                try {
                    repository.customerProfile(cid).collect {
                        profiles[cid] = it
                        publish()
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Throwable) {
                    // Best effort: the row keeps its fallback name.
                }
            }
        }
    }

    private fun publish() {
        _state.update { it.copy(rows = AgentInboxFormatting.rows(conversations, profiles, myUid)) }
    }

    internal companion object {
        const val DEFAULT_LIMIT: Int = 50
    }
}
