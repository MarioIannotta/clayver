#if canImport(UIKit)
import SwiftUI
import UIKit

/// The "Details" sheet of the agent conversation screen, opened from the "…" button: the
/// customer, assignment, open/closed, priority, status, tags, internal notes, the customer's
/// other conversations and blocking.
@MainActor
struct AgentConversationDetailsView: View {
    @ObservedObject var model: ClayverAgentConversationViewModel
    let theme: ClayverTheme
    let onDone: () -> Void
    /// Opens another conversation of the customer (the sheet is dismissed first).
    let openConversation: (String) -> Void

    @State private var noteDraft = ""
    @State private var showTagPicker = false
    @State private var blockReason: ClayverBlockStatus.Reason = .spam
    @State private var blockDuration: ClayverBlockDuration = .oneDay
    @State private var confirmBlock = false

    var body: some View {
        Form {
            customerSection
            propertiesSection
            conversationSection
            tagsSection
            notesSection
            conversationsSection
            blockSection
        }
        .navigationTitle("Details")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done", action: onDone)
            }
        }
        .tint(theme.accentColor)
        .sheet(isPresented: $showTagPicker) {
            NavigationView {
                AgentTagPickerView(model: model, theme: theme, onDone: { showTagPicker = false })
            }
            .navigationViewStyle(.stack)
        }
    }

    // MARK: Customer

    private var customerSection: some View {
        Section("Customer") {
            row("Name", model.customerName)
            if let email = model.profile?.email { row("Email", email) }
            if let account = model.profile?.account {
                row("Account", account.anonymous ? "Anonymous visitor" : (account.emailVerified ? "Signed in, email verified" : "Signed in"))
            }
            if let userId = model.profile?.userId { row("User ID", userId) }
            if let customerId = model.conversation?.customerId { row("Customer ID", customerId) }
            if let lastSeen = model.profile?.lastSeenAt {
                row("Last seen", lastSeen.formatted(date: .abbreviated, time: .shortened))
            } else {
                row("Last seen", "Unknown")
            }
        }
    }

    @ViewBuilder
    private var propertiesSection: some View {
        let properties = (model.profile?.customProperties ?? [:])
            .sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
        if !properties.isEmpty {
            Section("Properties") {
                ForEach(properties, id: \.key) { entry in
                    row(entry.key, entry.value.displayString)
                }
            }
        }
    }

    // MARK: Conversation

    private var conversationSection: some View {
        Section("Conversation") {
            HStack {
                Text("Assignee").font(theme.bodyFont).foregroundColor(.secondary)
                Spacer(minLength: 12)
                Text(model.assigneeName ?? "Unassigned").font(theme.bodyFont)
            }
            .accessibilityElement(children: .combine)
            if !model.isAssignedToMe {
                Button {
                    Task { await model.assign(toMe: true) }
                } label: {
                    Label("Assign to me", systemImage: "person.crop.circle.badge.checkmark")
                }
                .disabled(model.isUpdating || model.conversation == nil)
            }
            if model.isAssigned {
                Button {
                    Task { await model.assign(toMe: false) }
                } label: {
                    Label("Unassign", systemImage: "person.crop.circle.badge.xmark")
                }
                .disabled(model.isUpdating)
            }

            Picker("Open or closed", selection: Binding(
                get: { model.isClosed },
                set: { closed in
                    guard closed != model.isClosed else { return }
                    Task {
                        if closed {
                            await model.close()
                        } else {
                            await model.reopen()
                        }
                    }
                }
            )) {
                Text("Open").tag(false)
                Text("Closed").tag(true)
            }
            .pickerStyle(.segmented)
            .disabled(model.isUpdating || model.conversation == nil)
            .accessibilityLabel("Conversation state")

            triagePicker(.priority, title: "Priority")
            triagePicker(.stage, title: "Status")

            if let created = model.conversation?.createdAt {
                row("Started", created.formatted(date: .abbreviated, time: .shortened))
            }
        }
    }

    private func triagePicker(_ kind: ClayverTriageOption.Kind, title: String) -> some View {
        let options = model.triageOptions.options(kind)
        return Picker(selection: Binding<String?>(
            get: { model.triageOptions.option(kind, id: model.triage.value(kind))?.id },
            set: { value in Task { await model.setTriage(kind, value) } }
        )) {
            Text("None").tag(String?.none)
            ForEach(options) { option in
                HStack(spacing: 8) {
                    TagDot(color: option.color)
                    Text(option.name)
                }
                .tag(String?.some(option.id))
            }
        } label: {
            Text(title).font(theme.bodyFont)
        }
        .disabled(model.isUpdatingTriage || model.conversation == nil)
    }

    // MARK: Tags

    private var tagsSection: some View {
        Section("Tags") {
            ForEach(model.tags) { tag in
                HStack {
                    TagChip(name: tag.name, color: tag.color, theme: theme)
                    Spacer(minLength: 8)
                    Button {
                        Task { await model.setTag(tag.id, on: false) }
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundColor(.secondary)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Remove tag \(tag.name)")
                }
            }
            Button {
                showTagPicker = true
            } label: {
                Label(model.tags.isEmpty ? "Add tag" : "Edit tags", systemImage: "tag")
            }
        }
    }

    // MARK: Notes

    private var notesSection: some View {
        Section {
            ZStack(alignment: .topLeading) {
                if noteDraft.isEmpty {
                    Text("Add an internal note…")
                        .font(theme.bodyFont)
                        .foregroundColor(Color(UIColor.placeholderText))
                        .padding(.top, 8)
                        .padding(.leading, 4)
                        .accessibilityHidden(true)
                }
                TextEditor(text: $noteDraft)
                    .font(theme.bodyFont)
                    .frame(minHeight: 64)
                    .accessibilityLabel("New internal note")
            }
            Button {
                let text = noteDraft
                Task { @MainActor in
                    if await model.addNote(text) { noteDraft = "" }
                }
            } label: {
                HStack {
                    Text("Add note")
                    if model.isAddingNote {
                        Spacer()
                        ProgressView()
                    }
                }
            }
            .disabled(model.isAddingNote || noteDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            ForEach(model.notes) { note in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(noteAuthor(note))
                            .font(theme.captionFont.weight(.semibold))
                        Spacer(minLength: 8)
                        if let created = note.createdAt {
                            Text(created.formatted(date: .abbreviated, time: .shortened))
                                .font(theme.captionFont)
                                .foregroundColor(.secondary)
                        }
                    }
                    Text(note.text)
                        .font(theme.bodyFont)
                        .textSelection(.enabled)
                }
                .padding(.vertical, 2)
                .accessibilityElement(children: .combine)
                .swipeActions(edge: .trailing) {
                    if model.canDelete(note) {
                        Button(role: .destructive) {
                            Task { await model.deleteNote(note.id) }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
        } header: {
            Text("Internal notes")
        } footer: {
            Text("Only your team sees notes.")
        }
    }

    private func noteAuthor(_ note: ClayverInternalNote) -> String {
        if note.authorUid == model.agentUid { return "You" }
        return note.authorName ?? model.agentNames[note.authorUid] ?? "Teammate"
    }

    // MARK: Conversations

    private var conversationsSection: some View {
        Section("Conversations") {
            let conversations = model.customerConversations
            if conversations.isEmpty {
                Text("No other conversations.")
                    .font(theme.bodyFont)
                    .foregroundColor(.secondary)
            }
            ForEach(conversations) { conversation in
                if conversation.id == model.conversationId {
                    conversationRow(conversation, current: true)
                } else {
                    Button {
                        openConversation(conversation.id)
                    } label: {
                        conversationRow(conversation, current: false)
                    }
                    .accessibilityHint("Opens this conversation")
                }
            }
        }
    }

    private func conversationRow(_ conversation: ClayverAgentConversation, current: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(current ? "This conversation" : (conversation.lastActivityAt?.formatted(date: .abbreviated, time: .shortened) ?? "Conversation"))
                    .font(theme.bodyFont.weight(current ? .semibold : .regular))
                    .foregroundColor(.primary)
                Spacer(minLength: 6)
                Text(conversation.status == .closed ? "Closed" : "Open")
                    .font(theme.captionFont.weight(.semibold))
                    .foregroundColor(conversation.status == .closed ? .secondary : theme.accentColor)
            }
            Text(ClayverAgentInboxViewModel.preview(conversation.lastMessage))
                .font(theme.captionFont)
                .foregroundColor(.secondary)
                .lineLimit(2)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    // MARK: Block

    private var blockSection: some View {
        Section {
            if let block = model.blockStatus {
                row("Blocked", Self.reasonLabel(block.reason))
                row("Until", block.until?.formatted(date: .abbreviated, time: .shortened) ?? "Unblocked by an agent")
                Button {
                    Task { await model.unblockCustomer() }
                } label: {
                    HStack {
                        Text("Unblock customer")
                        if model.isUpdatingBlock {
                            Spacer()
                            ProgressView()
                        }
                    }
                }
                .disabled(model.isUpdatingBlock || model.conversation == nil)
            } else {
                Picker("Reason", selection: $blockReason) {
                    ForEach([ClayverBlockStatus.Reason.spam, .abuse, .other], id: \.self) { reason in
                        Text(Self.reasonLabel(reason)).tag(reason)
                    }
                }
                Picker("Duration", selection: $blockDuration) {
                    ForEach(ClayverBlockDuration.allCases) { duration in
                        Text(duration.label).tag(duration)
                    }
                }
                Button(role: .destructive) {
                    confirmBlock = true
                } label: {
                    HStack {
                        Text("Block customer")
                        if model.isUpdatingBlock {
                            Spacer()
                            ProgressView()
                        }
                    }
                }
                .disabled(model.isUpdatingBlock || model.conversation == nil)
                .confirmationDialog("Block \(model.customerName)?", isPresented: $confirmBlock, titleVisibility: .visible) {
                    Button("Block", role: .destructive) {
                        let reason = blockReason
                        let duration = blockDuration
                        Task { await model.blockCustomer(reason: reason, duration: duration) }
                    }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("They won't be able to start conversations or send messages (\(blockDuration.label.lowercased())). Their history stays visible.")
                }
            }
        } header: {
            Text("Block")
        }
    }

    static func reasonLabel(_ reason: ClayverBlockStatus.Reason) -> String {
        switch reason {
        case .spam: return "Spam"
        case .abuse: return "Abuse"
        case .rateLimit: return "Rate limit"
        case .other: return "Other"
        }
    }

    // MARK: Helpers

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(theme.bodyFont)
                .foregroundColor(.secondary)
            Spacer(minLength: 12)
            Text(value)
                .font(theme.bodyFont)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .accessibilityElement(children: .combine)
    }
}
#endif
