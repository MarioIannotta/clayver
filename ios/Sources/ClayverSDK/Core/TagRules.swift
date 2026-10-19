import Foundation

/// Tag ids, colors and search from `firebase/database.schema.md` (`tags/{tagId}`). Pure, so the
/// rules can be tested without Firebase and match the other platforms exactly.
public enum ClayverTagRules {
    /// Colors offered for new tags. The default for a tag is picked by its slug
    /// (`defaultColor(forSlug:)`).
    public static let palette = [
        "#2563EB", "#7C3AED", "#D97706", "#64748B", "#DC2626",
        "#EA580C", "#0D9488", "#16A34A", "#0891B2", "#DB2777",
    ]

    /// `tags/{id}/name` is 1-40 characters (UTF-16 code units, as in the rules).
    public static let maxNameLength = 40
    /// Slugs are cut to 40 characters.
    public static let maxSlugLength = 40

    /// The slug of a tag name: lowercase, strip diacritics (NFKD, drop combining marks), replace
    /// every run of characters outside `[a-z0-9]` with `-`, trim `-`, cut to 40 characters.
    /// `nil` when the name has no usable characters (for example only emoji).
    public static func slug(_ name: String) -> String? {
        let decomposed = name.lowercased().decomposedStringWithCompatibilityMapping
        var slug = ""
        var pendingDash = false
        for scalar in decomposed.unicodeScalars {
            if isCombiningMark(scalar) { continue }
            if isSlugCharacter(scalar) {
                if pendingDash && !slug.isEmpty { slug.append("-") }
                pendingDash = false
                slug.unicodeScalars.append(scalar)
            } else {
                pendingDash = true
            }
        }
        // Leading runs never produce a dash and trailing runs are never flushed, which is the
        // "trim `-`" step. Cutting can still leave a trailing dash, as the id pattern allows.
        guard !slug.isEmpty else { return nil }
        var cut = String(slug.prefix(maxSlugLength))
        while cut.hasSuffix("-") { cut.removeLast() }
        return cut
    }

    /// The id a new tag named `name` gets: its slug, or `tag-` plus 8 random `[a-z0-9]` when
    /// the name has no usable characters.
    public static func tagId(forName name: String) -> String {
        slug(name) ?? randomTagId()
    }

    /// `tag-` plus 8 random `[a-z0-9]`.
    static func randomTagId() -> String {
        let alphabet = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        return "tag-" + String((0..<8).map { _ in alphabet.randomElement()! })
    }

    /// The palette color for a slug: the sum of its UTF-16 code units modulo 10.
    public static func defaultColor(forSlug slug: String) -> String {
        let sum = slug.utf16.reduce(0) { $0 + Int($1) }
        return palette[sum % palette.count]
    }

    /// Whether `color` is a `#rrggbb` hex color.
    public static func isValidColor(_ color: String) -> Bool {
        rgb(fromHex: color) != nil
    }

    /// The red, green and blue components (0...1) of a `#rrggbb` color, or `nil` when the string
    /// is not one.
    public static func rgb(fromHex hex: String) -> (red: Double, green: Double, blue: Double)? {
        guard hex.hasPrefix("#"), hex.unicodeScalars.count == 7 else { return nil }
        let digits = String(hex.dropFirst())
        let hexDigits = CharacterSet(charactersIn: "0123456789abcdefABCDEF")
        guard digits.unicodeScalars.allSatisfy({ hexDigits.contains($0) }),
              let value = UInt32(digits, radix: 16) else { return nil }
        return (
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }

    /// The trimmed tag name. Throws `invalidArgument` when it is empty or longer than 40 characters.
    static func normalizedName(_ name: String) throws -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw ClayverError.invalidArgument("A tag needs a name.") }
        guard trimmed.utf16.count <= maxNameLength else {
            throw ClayverError.invalidArgument("Tag names are limited to \(maxNameLength) characters.")
        }
        return trimmed
    }

    private static func isCombiningMark(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .nonspacingMark, .spacingMark, .enclosingMark: return true
        default: return false
        }
    }

    private static func isSlugCharacter(_ scalar: Unicode.Scalar) -> Bool {
        (0x61...0x7A).contains(scalar.value) || (0x30...0x39).contains(scalar.value)
    }
}

/// What the "Add tag" sheet shows for a search text: the matching tags, and whether a
/// "Create tag" row is offered.
public struct ClayverTagSearch: Equatable {
    /// Catalog tags whose name contains the query (all tags for an empty query), by name.
    public let matches: [ClayverTag]
    /// The trimmed query, when no tag has exactly that name or slug and it is a valid new name.
    public let createName: String?

    public init(tags: [ClayverTag], query: String) {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let sorted = ClayverTag.sortedByName(tags)
        guard !trimmed.isEmpty else {
            matches = sorted
            createName = nil
            return
        }
        matches = sorted.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
        let slug = ClayverTagRules.slug(trimmed)
        let exists = tags.contains { tag in
            tag.name.trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare(trimmed) == .orderedSame
                || (slug != nil && tag.id == slug)
        }
        createName = exists || trimmed.utf16.count > ClayverTagRules.maxNameLength ? nil : trimmed
    }
}
