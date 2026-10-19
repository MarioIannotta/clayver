package com.clayver.sdk.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.clayver.sdk.ClayverAttachmentInput
import com.clayver.sdk.ClayverBlockReason
import com.clayver.sdk.ClayverConversationStatus
import com.clayver.sdk.notifications.ChatVisibility
import kotlinx.coroutines.flow.StateFlow

/** Adapts [AgentInboxController] to `viewModelScope`. */
internal class AgentInboxViewModel(repository: AgentRepository) : ViewModel() {
    private val controller = AgentInboxController(repository, viewModelScope)
    val state: StateFlow<AgentInboxUiState> = controller.state

    fun selectTab(status: ClayverConversationStatus) = controller.selectTab(status)
    fun selectTag(tagId: String?) = controller.selectTag(tagId)
    fun retry() = controller.retry()

    companion object {
        fun factory(): ViewModelProvider.Factory = viewModelFactory {
            initializer { AgentInboxViewModel(FirebaseAgentRepository()) }
        }
    }
}

/** Adapts [AgentConversationController] to `viewModelScope`. */
internal class AgentConversationViewModel(
    private val repository: AgentRepository,
    private val conversationId: String,
) : ViewModel(), MessageListActions, ComposerActions {
    private val controller = AgentConversationController(repository, viewModelScope, conversationId)
    val state: StateFlow<AgentChatUiState> = controller.state

    fun retry() = controller.retry()
    fun toggleStatus() = controller.toggleStatus()
    fun assign(toMe: Boolean) = controller.assign(toMe)
    fun dismissActionError() = controller.dismissActionError()
    fun toggleTag(tagId: String) = controller.toggleTag(tagId)
    fun createTag(name: String) = controller.createTag(name)
    fun setPriority(optionId: String?) = controller.setPriority(optionId)
    fun setStage(optionId: String?) = controller.setStage(optionId)
    fun onNoteDraftChange(text: String) = controller.onNoteDraftChange(text)
    fun addNote() = controller.addNote()
    fun deleteNote(noteId: String) = controller.deleteNote(noteId)
    fun blockCustomer(reason: ClayverBlockReason, durationMillis: Long?) = controller.blockCustomer(reason, durationMillis)
    fun unblockCustomer() = controller.unblockCustomer()
    override fun loadOlder() = controller.loadOlder()
    override fun onDraftChange(text: String) = controller.onDraftChange(text)
    override fun attach(input: ClayverAttachmentInput) = controller.attach(input)
    override fun reportComposerError(error: Throwable) = controller.reportComposerError(error)
    override fun removeAttachment() = controller.removeAttachment()
    override fun send() = controller.send()
    override fun retrySend(key: String) = controller.retrySend(key)
    override fun discard(key: String) = controller.discard(key)
    override suspend fun attachmentUrl(storagePath: String): String = repository.attachmentUrl(storagePath)

    fun setVisible(visible: Boolean) {
        if (visible) {
            ChatVisibility.visibleAgentConversationId = conversationId
        } else if (ChatVisibility.visibleAgentConversationId == conversationId) {
            ChatVisibility.visibleAgentConversationId = null
        }
        controller.setVisible(visible)
    }

    override fun onCleared() {
        if (ChatVisibility.visibleAgentConversationId == conversationId) ChatVisibility.visibleAgentConversationId = null
    }

    companion object {
        fun factory(conversationId: String): ViewModelProvider.Factory = viewModelFactory {
            initializer { AgentConversationViewModel(FirebaseAgentRepository(), conversationId) }
        }
    }
}
