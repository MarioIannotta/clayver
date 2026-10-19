package com.clayver.sdk.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.clayver.sdk.ClayverAttachmentInput
import com.clayver.sdk.notifications.ChatVisibility
import kotlinx.coroutines.flow.StateFlow

/**
 * Android ViewModel for [ClayverChatScreen]. It only adapts [ChatController]
 * (pure Kotlin, unit tested with a fake [ChatRepository]) to `viewModelScope`.
 */
internal class ChatViewModel(
    val repository: ChatRepository,
    conversationId: String?,
    newConversation: Boolean,
) : ViewModel(), MessageListActions, ComposerActions {
    private val controller = ChatController(repository, viewModelScope, conversationId, newConversation = newConversation)
    val state: StateFlow<ChatUiState> = controller.state

    fun retry() = controller.retry()
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
        val id = state.value.conversationId
        if (visible) {
            ChatVisibility.visibleConversationId = id
        } else if (ChatVisibility.visibleConversationId == id) {
            ChatVisibility.visibleConversationId = null
        }
        controller.setVisible(visible)
    }

    override fun onCleared() {
        if (ChatVisibility.visibleConversationId == state.value.conversationId) ChatVisibility.visibleConversationId = null
    }

    companion object {
        fun factory(conversationId: String?, newConversation: Boolean = false): ViewModelProvider.Factory = viewModelFactory {
            initializer { ChatViewModel(FirebaseChatRepository(), conversationId, newConversation) }
        }
    }
}

/** Adapts [ConversationListController] to `viewModelScope`. */
internal class ConversationListViewModel(repository: ChatRepository) : ViewModel() {
    private val controller = ConversationListController(repository, viewModelScope)
    val state: StateFlow<ConversationListUiState> = controller.state

    fun retry() = controller.retry()

    companion object {
        fun factory(): ViewModelProvider.Factory = viewModelFactory {
            initializer { ConversationListViewModel(FirebaseChatRepository()) }
        }
    }
}
