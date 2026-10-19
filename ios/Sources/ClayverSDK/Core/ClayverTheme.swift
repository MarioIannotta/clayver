import SwiftUI
import UIKit

/// Appearance of the built-in chat UI.
///
/// Fonts default to Dynamic Type text styles. For a custom typeface, keep Dynamic Type
/// working by using `Font.custom(_:size:relativeTo:)`, e.g.
/// `.custom("Avenir Next", size: 17, relativeTo: .body)`.
public struct ClayverTheme {
    /// Navigation title. When `nil`, the workspace `teamName` from `config/public` is used, then "Support".
    public var title: String?
    /// Tint for buttons, links and the composer.
    public var accentColor: Color
    public var customerBubbleColor: Color
    public var customerTextColor: Color
    public var agentBubbleColor: Color
    public var agentTextColor: Color
    /// Message text.
    public var bodyFont: Font
    /// Timestamps, sender names, status lines.
    public var captionFont: Font
    /// Empty and error state headlines.
    public var headlineFont: Font

    public init(
        title: String? = nil,
        accentColor: Color = .accentColor,
        customerBubbleColor: Color? = nil,
        customerTextColor: Color = .white,
        agentBubbleColor: Color = Color(UIColor.secondarySystemBackground),
        agentTextColor: Color = .primary,
        bodyFont: Font = .body,
        captionFont: Font = .caption2,
        headlineFont: Font = .headline
    ) {
        self.title = title
        self.accentColor = accentColor
        self.customerBubbleColor = customerBubbleColor ?? accentColor
        self.customerTextColor = customerTextColor
        self.agentBubbleColor = agentBubbleColor
        self.agentTextColor = agentTextColor
        self.bodyFont = bodyFont
        self.captionFont = captionFont
        self.headlineFont = headlineFont
    }

    public static var `default`: ClayverTheme { ClayverTheme() }
}
