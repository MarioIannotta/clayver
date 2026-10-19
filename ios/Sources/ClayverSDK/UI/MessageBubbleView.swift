#if canImport(UIKit)
import SwiftUI
import UIKit

@MainActor
struct MessageBubbleView: View {
    let item: ClayverChatMessageItem
    let theme: ClayverTheme
    var perspective: ClayverMessagePerspective = .customer
    let loadURL: @MainActor (ClayverAttachment) async throws -> URL
    let open: (ClayverAttachment) -> Void
    let retry: () -> Void
    let discard: () -> Void

    private var isMine: Bool { item.isOutgoing }
    private var message: ClayverMessage { item.message }

    var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            if isMine { Spacer(minLength: 48) }
            VStack(alignment: isMine ? .trailing : .leading, spacing: 3) {
                if let name = senderLabel {
                    Text(name)
                        .font(theme.captionFont)
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 4)
                }
                bubble
                footer
            }
            if !isMine { Spacer(minLength: 48) }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
        .modifier(BubbleAccessibilityActions(
            failed: { if case .failed = item.delivery { return true } else { return false } }(),
            attachment: message.attachment,
            retry: retry,
            discard: discard,
            open: open
        ))
    }

    private var senderLabel: String? {
        perspective.senderLabel(for: message)
    }

    @ViewBuilder
    private var bubble: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let attachment = message.attachment {
                AttachmentContentView(attachment: attachment, theme: theme, isMine: isMine, loadURL: loadURL, open: open)
            } else if let local = item.localAttachment {
                LocalAttachmentView(input: local, theme: theme, isMine: isMine)
            }
            if let text = message.text, !text.isEmpty {
                Text(text)
                    .font(theme.bodyFont)
                    .foregroundColor(isMine ? theme.customerTextColor : theme.agentTextColor)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(isMine ? theme.customerBubbleColor : theme.agentBubbleColor)
        )
        .opacity(item.delivery == .sending ? 0.7 : 1)
        .contextMenu {
            if let text = message.text, !text.isEmpty {
                Button {
                    UIPasteboard.general.string = text
                } label: {
                    Label("Copy", systemImage: "doc.on.doc")
                }
            }
        }
    }

    @ViewBuilder
    private var footer: some View {
        switch item.delivery {
        case .sending:
            Text("Sending…")
                .font(theme.captionFont)
                .foregroundColor(.secondary)
                .padding(.horizontal, 4)
        case .failed:
            HStack(spacing: 10) {
                Button(action: retry) {
                    Label("Not sent. Retry", systemImage: "exclamationmark.circle")
                }
                .foregroundColor(.red)
                Button("Delete", role: .destructive, action: discard)
            }
            .font(theme.captionFont)
            .padding(.horizontal, 4)
        case .sent:
            HStack(spacing: 4) {
                Text(message.createdAt, style: .time)
                if item.isSeen {
                    Text("· Seen")
                }
            }
            .font(theme.captionFont)
            .foregroundColor(.secondary)
            .padding(.horizontal, 4)
        }
    }

    private var accessibilityText: String {
        var parts: [String] = [perspective.spokenSender(for: message)]
        if let attachment = message.attachment ?? item.localAttachment.map({
            ClayverAttachment(storagePath: "", fileName: $0.fileName, contentType: $0.contentType, size: $0.data.count)
        }) {
            parts.append(attachment.isImage ? "sent a photo" : "sent a file, \(attachment.fileName)")
        }
        if let text = message.text, !text.isEmpty { parts.append(text) }
        switch item.delivery {
        case .sending: parts.append("Sending")
        case .failed: parts.append("Not sent")
        case .sent:
            parts.append(message.createdAt.formatted(date: .omitted, time: .shortened))
            if item.isSeen { parts.append("Seen") }
        }
        return parts.joined(separator: ", ")
    }
}

/// Custom VoiceOver actions (iOS 15 compatible, hence not `accessibilityActions {}`).
@MainActor
private struct BubbleAccessibilityActions: ViewModifier {
    let failed: Bool
    let attachment: ClayverAttachment?
    let retry: () -> Void
    let discard: () -> Void
    let open: (ClayverAttachment) -> Void

    @ViewBuilder
    func body(content: Content) -> some View {
        if failed {
            content
                .accessibilityAction(named: "Retry sending", retry)
                .accessibilityAction(named: "Delete message", discard)
        } else if let attachment {
            content.accessibilityAction(named: "Open \(attachment.fileName)") { open(attachment) }
        } else {
            content
        }
    }
}

/// Image thumbnail or file row for a stored attachment.
@MainActor
struct AttachmentContentView: View {
    let attachment: ClayverAttachment
    let theme: ClayverTheme
    let isMine: Bool
    let loadURL: @MainActor (ClayverAttachment) async throws -> URL
    let open: (ClayverAttachment) -> Void

    @ScaledMetric(relativeTo: .body) private var maxImageWidth: CGFloat = 220
    @State private var url: URL?
    @State private var failed = false

    var body: some View {
        Button { open(attachment) } label: {
            if attachment.isImage {
                image
            } else {
                FileRowView(fileName: attachment.fileName, size: attachment.size, theme: theme, isMine: isMine)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(attachment.isImage ? "Photo" : "File \(attachment.fileName)")
        .accessibilityHint("Opens the attachment")
        .task(id: attachment.storagePath) {
            guard attachment.isImage, url == nil else { return }
            do {
                url = try await loadURL(attachment)
            } catch {
                failed = true
            }
        }
    }

    private var aspectRatio: CGFloat {
        guard let width = attachment.width, let height = attachment.height, width > 0, height > 0 else { return 4 / 3 }
        return min(max(CGFloat(width) / CGFloat(height), 0.5), 2.5)
    }

    @ViewBuilder
    private var image: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12).fill(Color(UIColor.tertiarySystemFill))
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .failure:
                        Image(systemName: "photo").foregroundColor(.secondary)
                    default:
                        ProgressView()
                    }
                }
            } else if failed {
                Image(systemName: "photo").foregroundColor(.secondary)
            } else {
                ProgressView()
            }
        }
        .frame(width: maxImageWidth, height: maxImageWidth / aspectRatio)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

/// Preview of an attachment that is still uploading.
@MainActor
struct LocalAttachmentView: View {
    let input: ClayverAttachmentInput
    let theme: ClayverTheme
    let isMine: Bool

    @ScaledMetric(relativeTo: .body) private var maxImageWidth: CGFloat = 220

    var body: some View {
        if input.isImage, let image = UIImage(data: input.data) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: maxImageWidth, height: maxImageWidth * min(max(image.size.height / max(image.size.width, 1), 0.4), 2))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .accessibilityLabel("Photo")
        } else {
            FileRowView(fileName: input.fileName, size: input.data.count, theme: theme, isMine: isMine)
        }
    }
}

@MainActor
struct FileRowView: View {
    let fileName: String
    let size: Int
    let theme: ClayverTheme
    let isMine: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "doc.fill")
                .font(.title2)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(fileName)
                    .font(theme.bodyFont.weight(.medium))
                    .lineLimit(2)
                Text(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
                    .font(theme.captionFont)
                    .opacity(0.8)
            }
        }
        .foregroundColor(isMine ? theme.customerTextColor : theme.agentTextColor)
        .accessibilityElement(children: .combine)
    }
}
#endif
