import XCTest
@testable import ClayverSDK

final class TagRulesTests: XCTestCase {
    func testSlugLowercasesAndJoinsWords() {
        XCTAssertEqual(ClayverTagRules.slug("Waiting on customer"), "waiting-on-customer")
        XCTAssertEqual(ClayverTagRules.slug("Feature Request"), "feature-request")
        XCTAssertEqual(ClayverTagRules.slug("VIP"), "vip")
        XCTAssertEqual(ClayverTagRules.slug("iOS 17"), "ios-17")
    }

    func testSlugStripsDiacritics() {
        XCTAssertEqual(ClayverTagRules.slug("Café Crème"), "cafe-creme")
        XCTAssertEqual(ClayverTagRules.slug("Ñandú"), "nandu")
        XCTAssertEqual(ClayverTagRules.slug("Ünïcödé"), "unicode")
        // NFKD also unfolds compatibility characters.
        XCTAssertEqual(ClayverTagRules.slug("ﬁx"), "fix")
    }

    func testSlugCollapsesAndTrimsSeparators() {
        XCTAssertEqual(ClayverTagRules.slug("  --Hello__World!!  "), "hello-world")
        XCTAssertEqual(ClayverTagRules.slug("a / b & c"), "a-b-c")
        XCTAssertEqual(ClayverTagRules.slug("Bug 🐛 report"), "bug-report")
    }

    func testSlugIsCutTo40Characters() {
        let slug = ClayverTagRules.slug(String(repeating: "abcde ", count: 20))
        XCTAssertEqual(slug?.count, 40)
        XCTAssertEqual(slug, "abcde-abcde-abcde-abcde-abcde-abcde-abcd")
    }

    func testNameWithoutUsableCharactersGetsRandomId() throws {
        XCTAssertNil(ClayverTagRules.slug("🔥🔥"))
        XCTAssertNil(ClayverTagRules.slug("---"))
        let id = ClayverTagRules.tagId(forName: "🔥")
        let regex = try NSRegularExpression(pattern: "^tag-[a-z0-9]{8}$")
        XCTAssertNotNil(regex.firstMatch(in: id, range: NSRange(id.startIndex..., in: id)), id)
        XCTAssertEqual(ClayverTagRules.tagId(forName: "Billing"), "billing")
    }

    func testSlugsMatchTheIdPattern() throws {
        let regex = try NSRegularExpression(pattern: "^[a-z0-9][a-z0-9-]{0,39}$")
        for name in ["To do", "  Ärger ", "x", "1-2-3", String(repeating: "long name ", count: 10)] {
            let slug = try XCTUnwrap(ClayverTagRules.slug(name))
            XCTAssertNotNil(regex.firstMatch(in: slug, range: NSRange(slug.startIndex..., in: slug)), slug)
        }
    }

    func testDefaultColorBySlug() {
        // Sum of UTF-16 code units modulo 10.
        XCTAssertEqual(ClayverTagRules.defaultColor(forSlug: "todo"), "#0891B2")   // 438 → 8
        XCTAssertEqual(ClayverTagRules.defaultColor(forSlug: "vip"), "#EA580C")    // 335 → 5
        XCTAssertEqual(ClayverTagRules.defaultColor(forSlug: "urgent"), "#7C3AED") // 661 → 1
        XCTAssertEqual(ClayverTagRules.defaultColor(forSlug: "refund"), "#DC2626") // 634 → 4
        XCTAssertEqual(ClayverTagRules.palette.count, 10)
    }

    func testHexColors() throws {
        XCTAssertTrue(ClayverTagRules.isValidColor("#2563EB"))
        XCTAssertTrue(ClayverTagRules.isValidColor("#ffffff"))
        XCTAssertFalse(ClayverTagRules.isValidColor("2563EB"))
        XCTAssertFalse(ClayverTagRules.isValidColor("#2563E"))
        XCTAssertFalse(ClayverTagRules.isValidColor("#+12345"))
        XCTAssertFalse(ClayverTagRules.isValidColor("#GGGGGG"))
        let rgb = try XCTUnwrap(ClayverTagRules.rgb(fromHex: "#FF8000"))
        XCTAssertEqual(rgb.red, 1, accuracy: 0.001)
        XCTAssertEqual(rgb.green, 128.0 / 255, accuracy: 0.001)
        XCTAssertEqual(rgb.blue, 0, accuracy: 0.001)
    }

    func testNormalizedName() throws {
        XCTAssertEqual(try ClayverTagRules.normalizedName("  Billing "), "Billing")
        XCTAssertThrowsError(try ClayverTagRules.normalizedName("   "))
        XCTAssertThrowsError(try ClayverTagRules.normalizedName(String(repeating: "a", count: 41)))
    }

    func testSearchFiltersAndOffersCreate() {
        let tags = [
            ClayverTag(id: "bug", name: "Bug", color: "#EA580C"),
            ClayverTag(id: "billing", name: "Billing", color: "#16A34A"),
            ClayverTag(id: "feature-request", name: "Feature request", color: "#0D9488"),
        ]
        let all = ClayverTagSearch(tags: tags, query: "  ")
        XCTAssertEqual(all.matches.map(\.id), ["billing", "bug", "feature-request"])
        XCTAssertNil(all.createName)

        let partial = ClayverTagSearch(tags: tags, query: "bi")
        XCTAssertEqual(partial.matches.map(\.id), ["billing"])
        XCTAssertEqual(partial.createName, "bi")

        let exact = ClayverTagSearch(tags: tags, query: " bug ")
        XCTAssertEqual(exact.matches.map(\.id), ["bug"])
        XCTAssertNil(exact.createName)

        // Same slug as an existing tag: creating would return that tag, so no "Create" row.
        let sameSlug = ClayverTagSearch(tags: tags, query: "Feature-Request!")
        XCTAssertNil(sameSlug.createName)

        let new = ClayverTagSearch(tags: tags, query: "Refund")
        XCTAssertTrue(new.matches.isEmpty)
        XCTAssertEqual(new.createName, "Refund")
    }

    func testParsesTagsAndConversationTags() {
        let children: [(key: String, value: Any?)] = [
            ("urgent", ["name": "Urgent", "color": "#DC2626", "createdAt": NSNumber(value: 1), "createdBy": "system"] as [String: Any]),
            ("bug", ["name": "Bug", "color": "not a color"]),
            ("broken", ["color": "#000000"]),
        ]
        let tags = ClayverParsing.tags(children: children)
        XCTAssertEqual(tags.map(\.id), ["bug", "urgent"])
        XCTAssertEqual(tags.first?.color, ClayverTagRules.defaultColor(forSlug: "bug"))
        XCTAssertEqual(tags.last?.color, "#DC2626")

        let ids = ClayverParsing.tagIds(["urgent": NSNumber(value: true), "bug": NSNumber(value: true), "old": NSNumber(value: false)])
        XCTAssertEqual(ids, ["bug", "urgent"])
        XCTAssertEqual(ClayverParsing.tagIds(nil), [])
    }
}
