#if canImport(UIKit)
import SwiftUI
import UIKit

extension Color {
    /// A tag color (`#rrggbb`); gray when the string is not one.
    static func clayverTag(_ hex: String) -> Color {
        guard let rgb = ClayverTagRules.rgb(fromHex: hex) else { return Color(UIColor.systemGray) }
        return Color(red: rgb.red, green: rgb.green, blue: rgb.blue)
    }
}

/// The small colored circle in front of a tag name.
struct TagDot: View {
    let color: String
    @ScaledMetric(relativeTo: .caption) private var size: CGFloat = 8

    var body: some View {
        Circle()
            .fill(Color.clayverTag(color))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// A tag as a capsule: color dot and name on a tinted background. `selected` fills it more.
@MainActor
struct TagChip: View {
    let name: String
    let color: String
    let theme: ClayverTheme
    var selected = false

    var body: some View {
        HStack(spacing: 5) {
            TagDot(color: color)
            Text(name)
                .font(theme.captionFont.weight(.semibold))
                .foregroundColor(.primary)
                .lineLimit(1)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(Capsule().fill(Color.clayverTag(color).opacity(selected ? 0.3 : 0.14)))
        .overlay(Capsule().strokeBorder(Color.clayverTag(color).opacity(selected ? 0.9 : 0), lineWidth: 1))
    }
}

/// The "Add tag" sheet: search the catalog, toggle tags on the conversation, and create a tag
/// from the search text when no tag has that name.
@MainActor
struct AgentTagPickerView: View {
    @ObservedObject var model: ClayverAgentConversationViewModel
    let theme: ClayverTheme
    let onDone: () -> Void

    @State private var query = ""
    @State private var creating = false

    var body: some View {
        let search = ClayverTagSearch(tags: model.allTags, query: query)
        List {
            if let name = search.createName {
                Button {
                    create(name)
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "plus.circle.fill")
                            .foregroundColor(theme.accentColor)
                            .accessibilityHidden(true)
                        Text("Create tag \u{201C}\(name)\u{201D}")
                            .font(theme.bodyFont)
                            .foregroundColor(.primary)
                        Spacer(minLength: 4)
                        if creating { ProgressView() }
                    }
                }
                .disabled(creating)
            }
            ForEach(search.matches) { tag in
                Button {
                    Task { await model.toggleTag(tag.id) }
                } label: {
                    HStack(spacing: 10) {
                        TagDot(color: tag.color)
                        Text(tag.name)
                            .font(theme.bodyFont)
                            .foregroundColor(.primary)
                        Spacer(minLength: 4)
                        if model.hasTag(tag.id) {
                            Image(systemName: "checkmark")
                                .foregroundColor(theme.accentColor)
                                .accessibilityHidden(true)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .accessibilityLabel(tag.name)
                .accessibilityValue(model.hasTag(tag.id) ? "On" : "Off")
                .accessibilityAddTraits(model.hasTag(tag.id) ? .isSelected : [])
            }
            if search.matches.isEmpty && search.createName == nil {
                Text(model.allTags.isEmpty ? "No tags yet. Type a name to create one." : "No matching tags.")
                    .font(theme.bodyFont)
                    .foregroundColor(.secondary)
            }
        }
        .listStyle(.insetGrouped)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search or create a tag")
        .disableAutocorrection(true)
        .navigationTitle("Tags")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done", action: onDone)
            }
        }
        .tint(theme.accentColor)
    }

    private func create(_ name: String) {
        guard !creating else { return }
        creating = true
        Task { @MainActor in
            await model.createAndAddTag(named: name)
            creating = false
            query = ""
        }
    }
}

/// The inbox's tag filter: "All" and every tag, scrolling horizontally.
@MainActor
struct AgentInboxTagFilterRow: View {
    let tags: [ClayverTag]
    let selectedTagId: String?
    let theme: ClayverTheme
    let select: (String?) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                Button {
                    select(nil)
                } label: {
                    Text("All")
                        .font(theme.captionFont.weight(.semibold))
                        .foregroundColor(selectedTagId == nil ? .white : .primary)
                        .padding(.horizontal, 11)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(selectedTagId == nil ? theme.accentColor : Color(UIColor.tertiarySystemFill)))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("All conversations")
                .accessibilityAddTraits(selectedTagId == nil ? .isSelected : [])

                ForEach(tags) { tag in
                    Button {
                        select(selectedTagId == tag.id ? nil : tag.id)
                    } label: {
                        TagChip(name: tag.name, color: tag.color, theme: theme, selected: selectedTagId == tag.id)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Tagged \(tag.name)")
                    .accessibilityAddTraits(selectedTagId == tag.id ? .isSelected : [])
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Filter by tag")
    }
}
#endif
