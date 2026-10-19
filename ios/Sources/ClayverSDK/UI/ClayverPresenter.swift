#if canImport(UIKit)
import SwiftUI
import UIKit
import QuickLook

/// Presents the chat or the agent inbox modally from UIKit (`Clayver.openChat`,
/// `Clayver.openAgentInbox`).
@available(iOSApplicationExtension, unavailable)
@MainActor
enum ClayverPresenter {
    private static weak var presented: UIViewController?

    /// `openChat`: see `ClayverSupportView`. With multiple conversations, the list (or a new chat
    /// pushed over it when the customer has no conversation yet), or the given conversation pushed
    /// over the list; the chat's back button leads to the list. Otherwise the single chat.
    static func present(conversationId: String?, from viewController: UIViewController?) {
        let entry = conversationId.map { ClayverConversationListView.Entry.conversation($0) } ?? .automatic
        presentSupport(entry: entry, from: viewController, caller: "openChat")
    }

    static func presentConversations(from viewController: UIViewController?) {
        presentSupport(entry: .list, from: viewController, caller: "openConversations")
    }

    /// A new empty chat: pushed over the list with multiple conversations, else on its own.
    static func presentNewConversation(from viewController: UIViewController?) {
        presentSupport(entry: .newConversation, from: viewController, caller: "openNewConversation")
    }

    private static func presentSupport(entry: ClayverConversationListView.Entry, from viewController: UIViewController?, caller: String) {
        let close = CloseAction()
        let root = ClayverSupportView(entry: entry, onClose: { close.run() })
        present(root, close: close, from: viewController, caller: caller)
    }

    static func presentAgentInbox(conversationId: String?, from viewController: UIViewController?) {
        let close = CloseAction()
        let root = NavigationView {
            ClayverAgentInboxView(conversationId: conversationId, onClose: { close.run() })
        }
        .navigationViewStyle(.stack)
        present(root, close: close, from: viewController, caller: "openAgentInbox")
    }

    private static func present<Root: View>(_ root: Root, close: CloseAction, from viewController: UIViewController?, caller: String) {
        guard let presenter = viewController ?? topViewController() else {
            clayverLog.error("Clayver.\(caller, privacy: .public)(): no view controller to present from.")
            return
        }

        let host = UIHostingController(rootView: root)
        host.modalPresentationStyle = .pageSheet
        close.controller = host

        if let existing = presented, existing.presentingViewController != nil {
            // Replace the screen that is already open (e.g. a push for another conversation).
            existing.dismiss(animated: false) {
                (topViewController() ?? presenter).present(host, animated: true)
            }
        } else {
            presenter.present(host, animated: true)
        }
        presented = host
    }

    static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let windows = scenes.filter { $0.activationState == .foregroundActive }.flatMap(\.windows)
            + scenes.flatMap(\.windows)
        let window = windows.first(where: \.isKeyWindow) ?? windows.first
        var top = window?.rootViewController
        while let current = top {
            if let presented = current.presentedViewController, !presented.isBeingDismissed {
                top = presented
            } else if let navigation = current as? UINavigationController, let visible = navigation.topViewController {
                top = visible
            } else if let tab = current as? UITabBarController, let selected = tab.selectedViewController {
                top = selected
            } else {
                break
            }
        }
        return top
    }

    private final class CloseAction {
        weak var controller: UIViewController?
        func run() { controller?.dismiss(animated: true) }
    }
}

/// Quick Look for downloaded attachments.
struct QuickLookPreview: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UINavigationController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        controller.navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .done,
            target: context.coordinator,
            action: #selector(Coordinator.done)
        )
        context.coordinator.dismiss = context.environment.dismiss
        return UINavigationController(rootViewController: controller)
    }

    func updateUIViewController(_ uiViewController: UINavigationController, context: Context) {
        context.coordinator.dismiss = context.environment.dismiss
        if context.coordinator.url != url {
            context.coordinator.url = url
            (uiViewController.viewControllers.first as? QLPreviewController)?.reloadData()
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var url: URL
        var dismiss: DismissAction?
        init(url: URL) { self.url = url }

        @MainActor @objc func done() { dismiss?.callAsFunction() }

        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
            url as NSURL
        }
    }
}
#endif
