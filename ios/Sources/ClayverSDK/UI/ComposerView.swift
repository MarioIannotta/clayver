#if canImport(UIKit)
import SwiftUI
import UIKit
import PhotosUI
import UniformTypeIdentifiers

@MainActor
struct ComposerView<Model: ClayverThreadModel>: View {
    @ObservedObject var model: Model
    let theme: ClayverTheme

    @State private var showLegacyPhotoPicker = false
    @FocusState private var focused: Bool

    private var canSend: Bool {
        !model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            // Only photos can be attached (compressed to a JPEG of at most 300 KB).
            photoButton

            textField
                .focused($focused)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(Color(UIColor.secondarySystemBackground))
                )
                .accessibilityLabel("Message")

            Button(action: { model.sendDraft() }) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.title)
                    .foregroundColor(canSend ? theme.accentColor : Color(UIColor.tertiaryLabel))
                    .frame(minWidth: 36, minHeight: 36)
            }
            .disabled(!canSend)
            .accessibilityLabel("Send message")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .sheet(isPresented: $showLegacyPhotoPicker) {
            LegacyPhotoPicker { data, type in
                showLegacyPhotoPicker = false
                if let data { attachImage(data: data, type: type) }
            }
            .ignoresSafeArea()
        }
    }

    @ViewBuilder
    private var textField: some View {
        if #available(iOS 16.0, *) {
            TextField("Message", text: $model.draft, axis: .vertical)
                .font(theme.bodyFont)
                .lineLimit(1...6)
        } else {
            TextField("Message", text: $model.draft, onCommit: { model.sendDraft() })
                .font(theme.bodyFont)
                .submitLabel(.send)
        }
    }

    @ViewBuilder
    private var photoButton: some View {
        if #available(iOS 16.0, *) {
            ModernPhotoPickerButton(tint: theme.accentColor) { data, type in attachImage(data: data, type: type) }
        } else {
            Button {
                showLegacyPhotoPicker = true
            } label: {
                Image(systemName: "photo")
                    .font(.title3)
                    .foregroundColor(theme.accentColor)
                    .frame(minWidth: 32, minHeight: 36)
            }
            .accessibilityLabel("Attach a photo")
        }
    }

    /// The model compresses the photo (`ClayverAttachmentRules.prepared`) before upload.
    private func attachImage(data: Data, type: UTType?) {
        model.send(attachment: AttachmentPreparer.image(data: data, type: type))
    }
}

@available(iOS 16.0, *)
@MainActor
private struct ModernPhotoPickerButton: View {
    let tint: Color
    let onPick: (Data, UTType?) -> Void
    @State private var selection: PhotosPickerItem?

    var body: some View {
        PhotosPicker(selection: $selection, matching: .images, photoLibrary: .shared()) {
            Image(systemName: "photo")
                .font(.title3)
                .foregroundColor(tint)
                .frame(minWidth: 32, minHeight: 36)
        }
        .accessibilityLabel("Attach a photo")
        .onChange(of: selection) { item in
            guard let item else { return }
            selection = nil
            Task { @MainActor in
                if let data = try? await item.loadTransferable(type: Data.self) {
                    onPick(data, item.supportedContentTypes.first)
                }
            }
        }
    }
}

/// `PHPickerViewController` for iOS 15.
private struct LegacyPhotoPicker: UIViewControllerRepresentable {
    let onFinish: (Data?, UTType?) -> Void

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var configuration = PHPickerConfiguration()
        configuration.filter = .images
        configuration.selectionLimit = 1
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let onFinish: (Data?, UTType?) -> Void
        init(onFinish: @escaping (Data?, UTType?) -> Void) { self.onFinish = onFinish }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard let provider = results.first?.itemProvider else {
                onFinish(nil, nil)
                return
            }
            let typeIdentifier = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .image) == true })
                ?? UTType.image.identifier
            provider.loadDataRepresentation(forTypeIdentifier: typeIdentifier) { data, _ in
                DispatchQueue.main.async {
                    self.onFinish(data, UTType(typeIdentifier))
                }
            }
        }
    }
}

/// Turns picked photos into `ClayverAttachmentInput`s. Compression to a JPEG of at most
/// `ClayverAttachmentRules.maxSize` happens in `ClayverAttachmentRules.prepared`.
enum AttachmentPreparer {
    static func image(data: Data, type: UTType?) -> ClayverAttachmentInput {
        let mime = type?.preferredMIMEType ?? "image/jpeg"
        let ext = type?.preferredFilenameExtension ?? "jpg"
        return ClayverAttachmentInput(data: data, fileName: "photo-\(Self.timestamp()).\(ext)", contentType: mime)
    }

    private static func timestamp() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: Date())
    }
}
#endif
