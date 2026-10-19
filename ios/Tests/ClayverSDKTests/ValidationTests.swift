import XCTest
#if canImport(UIKit)
import UIKit
#endif
@testable import ClayverSDK

final class ValidationTests: XCTestCase {
    func testValidPropertyKeys() {
        for key in ["name", "email", "plan_tier", "a-b", "A1", String(repeating: "k", count: 64), Clayver.UserProperty.name, Clayver.UserProperty.uid] {
            XCTAssertTrue(ClayverValidation.isValidPropertyKey(key), key)
        }
    }

    func testInvalidPropertyKeys() {
        for key in ["", "has space", "dot.key", "slash/key", "emoji😀", String(repeating: "k", count: 65), "$x", "$name", "_custom", "_"] {
            XCTAssertFalse(ClayverValidation.isValidPropertyKey(key), key)
        }
    }

    func testValidateProperties() throws {
        try ClayverValidation.validateProperties([
            "name": "Ada",
            "age": 36,
            "score": 4.5,
            "vip": true,
            "bio": .string(String(repeating: "x", count: 1000)),
        ])
    }

    func testRejectsLongStringValue() {
        XCTAssertThrowsError(try ClayverValidation.validateProperties(["bio": .string(String(repeating: "x", count: 1001))])) { error in
            XCTAssertEqual((error as? ClayverError)?.code, .invalidArgument)
        }
    }

    func testRejectsNonFiniteNumbers() {
        XCTAssertThrowsError(try ClayverValidation.validateProperties(["n": .double(.nan)]))
        XCTAssertThrowsError(try ClayverValidation.validateProperties(["n": .double(.infinity)]))
    }

    func testRejectsInvalidKey() {
        XCTAssertThrowsError(try ClayverValidation.validateProperties(["bad key": "v"])) { error in
            XCTAssertEqual((error as? ClayverError)?.code, .invalidArgument)
        }
    }

    func testValueLiterals() {
        let values: [String: ClayverValue] = ["s": "x", "i": 1, "d": 1.5, "b": false]
        XCTAssertEqual(values["s"], .string("x"))
        XCTAssertEqual(values["i"], .int(1))
        XCTAssertEqual(values["d"], .double(1.5))
        XCTAssertEqual(values["b"], .bool(false))
    }

    func testMessageText() throws {
        XCTAssertNil(try ClayverValidation.normalizedText(nil))
        XCTAssertNil(try ClayverValidation.normalizedText("  \n "))
        XCTAssertEqual(try ClayverValidation.normalizedText("  hi  "), "hi")
        XCTAssertNoThrow(try ClayverValidation.normalizedText(String(repeating: "a", count: 4000)))
        XCTAssertThrowsError(try ClayverValidation.normalizedText(String(repeating: "a", count: 4001)))
    }

    func testProjectAndDeviceIds() {
        XCTAssertTrue(ClayverValidation.isValidProjectId("default"))
        XCTAssertTrue(ClayverValidation.isValidProjectId("my-app-2"))
        XCTAssertFalse(ClayverValidation.isValidProjectId("Default"))
        XCTAssertFalse(ClayverValidation.isValidProjectId(""))
        XCTAssertTrue(ClayverValidation.isValidDeviceId(DeviceIdStore.generate()))
        XCTAssertFalse(ClayverValidation.isValidDeviceId("short"))
    }

    func testDatabaseKeys() {
        XCTAssertTrue(ClayverValidation.isValidDatabaseKey("-NxAbc_123"))
        XCTAssertFalse(ClayverValidation.isValidDatabaseKey("a/b"))
        XCTAssertFalse(ClayverValidation.isValidDatabaseKey("a.b"))
        XCTAssertFalse(ClayverValidation.isValidDatabaseKey(""))
    }

    func testAttachmentRules() {
        XCTAssertEqual(ClayverAttachmentRules.maxSize, 300 * 1024)
        XCTAssertEqual(ClayverAttachmentRules.allowedContentTypes, ["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic"])
        XCTAssertNoThrow(try ClayverAttachmentRules.validate(contentType: "image/png", size: 10))
        XCTAssertNoThrow(try ClayverAttachmentRules.validate(contentType: "image/jpeg", size: ClayverAttachmentRules.maxSize))
        for type in ["application/pdf", "text/plain", "application/zip"] {
            XCTAssertThrowsError(try ClayverAttachmentRules.validate(contentType: type, size: 10)) { error in
                XCTAssertEqual((error as? ClayverError)?.code, .unsupportedAttachmentType)
            }
        }
        XCTAssertThrowsError(try ClayverAttachmentRules.validate(contentType: "image/png", size: ClayverAttachmentRules.maxSize + 1)) { error in
            XCTAssertEqual(error as? ClayverError, .attachmentTooLarge(size: ClayverAttachmentRules.maxSize + 1, limit: ClayverAttachmentRules.maxSize))
        }
        XCTAssertThrowsError(try ClayverAttachmentRules.validate(contentType: "video/mp4", size: 10)) { error in
            XCTAssertEqual((error as? ClayverError)?.code, .unsupportedAttachmentType)
        }
        XCTAssertThrowsError(try ClayverAttachmentRules.validate(contentType: "text/plain", size: 0))
    }

    func testPreparedRejectsNonImages() {
        XCTAssertThrowsError(try ClayverAttachmentRules.prepared(
            ClayverAttachmentInput(data: Data("hello".utf8), fileName: "notes.txt", contentType: "text/plain")
        )) { error in
            XCTAssertEqual((error as? ClayverError)?.code, .unsupportedAttachmentType)
        }
        XCTAssertThrowsError(try ClayverAttachmentRules.prepared(
            ClayverAttachmentInput(data: Data(), fileName: "a.png", contentType: "image/png")
        ))
    }

    #if canImport(UIKit)
    /// A large, noisy (hard to compress) PNG.
    private func noisyPNG(width: Int, height: Int) -> Data {
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let size = CGSize(width: width, height: height)
        let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
            var generator = SystemRandomNumberGenerator()
            for _ in 0..<4000 {
                UIColor(
                    red: .random(in: 0...1, using: &generator),
                    green: .random(in: 0...1, using: &generator),
                    blue: .random(in: 0...1, using: &generator),
                    alpha: 1
                ).setFill()
                context.fill(CGRect(
                    x: .random(in: 0..<CGFloat(width), using: &generator),
                    y: .random(in: 0..<CGFloat(height), using: &generator),
                    width: .random(in: 4...80, using: &generator),
                    height: .random(in: 4...80, using: &generator)
                ))
            }
        }
        return image.pngData()!
    }

    func testCompressesLargeImageToJPEGWithinLimits() throws {
        let png = noisyPNG(width: 3000, height: 2000)
        let output = try ClayverAttachmentRules.prepared(ClayverAttachmentInput(data: png, fileName: "shot.png", contentType: "image/png"))
        XCTAssertEqual(output.contentType, "image/jpeg")
        XCTAssertEqual(output.fileName, "shot.jpg")
        XCTAssertLessThanOrEqual(output.data.count, ClayverAttachmentRules.maxSize)
        let decoded = try XCTUnwrap(UIImage(data: output.data))
        XCTAssertEqual(output.width, Int(decoded.size.width * decoded.scale))
        XCTAssertEqual(output.height, Int(decoded.size.height * decoded.scale))
        XCTAssertLessThanOrEqual(max(output.width ?? .max, output.height ?? .max), Int(ClayverImageCompressor.maxDimension))
        // Compressing again leaves the data as it is.
        XCTAssertEqual(try ClayverAttachmentRules.prepared(output), output)
    }

    func testRawImageBytesWithGenericTypeAreCompressed() throws {
        let png = noisyPNG(width: 400, height: 300)
        let output = try ClayverAttachmentRules.prepared(
            ClayverAttachmentInput(data: png, fileName: "upload", contentType: "application/octet-stream")
        )
        XCTAssertEqual(output.contentType, "image/jpeg")
        XCTAssertEqual(output.fileName, "upload.jpg")
        XCTAssertEqual(output.width, 400)
        XCTAssertEqual(output.height, 300)
    }
    #endif

    func testContentTypeInference() {
        XCTAssertEqual(ClayverAttachmentRules.contentType(forFileName: "a.JPG"), "image/jpeg")
        XCTAssertEqual(ClayverAttachmentRules.contentType(forFileName: "report.pdf"), "application/pdf")
        XCTAssertEqual(ClayverAttachmentInput(data: Data([1]), fileName: "notes.txt").contentType, "text/plain")
    }

    func testSanitizedFileName() {
        XCTAssertEqual(ClayverAttachmentRules.sanitizedFileName("a/b\\c.pdf"), "a_b_c.pdf")
        XCTAssertEqual(ClayverAttachmentRules.sanitizedFileName("  "), "file")
        XCTAssertEqual(ClayverAttachmentRules.sanitizedFileName("..hidden"), "hidden")
        let long = String(repeating: "x", count: 300) + ".pdf"
        let sanitized = ClayverAttachmentRules.sanitizedFileName(long)
        XCTAssertEqual(sanitized.count, 200)
        XCTAssertTrue(sanitized.hasSuffix(".pdf"))
    }

    func testPaths() {
        let paths = ClayverPaths(projectId: "default")
        XCTAssertEqual(paths.messages("c1"), "clayver/projects/default/messages/c1")
        XCTAssertEqual(paths.customerRead("c1"), "clayver/projects/default/reads/c1/customer")
        XCTAssertEqual(paths.inboxUnreadTotal("v_x"), "clayver/projects/default/inbox/v_x/unreadTotal")
        XCTAssertEqual(paths.userProperties("u"), "clayver/projects/default/users/u/properties")
        XCTAssertEqual(paths.customerDevice("u", deviceId: "dev12345"), "clayver/projects/default/devices/customers/u/dev12345")
        XCTAssertEqual(
            paths.attachment(customerId: "u", conversationId: "c", attachmentId: "a", fileName: "f.png"),
            "clayver/projects/default/customers/u/conversations/c/a/f.png"
        )
    }
}
