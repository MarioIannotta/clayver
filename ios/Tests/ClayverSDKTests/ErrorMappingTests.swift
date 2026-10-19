import XCTest
@testable import ClayverSDK

final class ErrorMappingTests: XCTestCase {
    private func error(_ domain: String, _ code: Int, underlying: Error? = nil, description: String = "x") -> NSError {
        var info: [String: Any] = [NSLocalizedDescriptionKey: description]
        if let underlying { info[NSUnderlyingErrorKey] = underlying }
        return NSError(domain: domain, code: code, userInfo: info)
    }

    func testDatabaseErrors() {
        XCTAssertEqual(ClayverError.from(error("com.firebase", 1)), .permissionDenied)
        XCTAssertEqual(ClayverError.from(error("com.firebase", 2)), .network)
        XCTAssertEqual(ClayverError.from(error("com.firebase", 3)), .cancelled)
    }

    func testFunctionsErrors() {
        XCTAssertEqual(ClayverError.from(error("com.firebase.functions", 7)), .permissionDenied)
        XCTAssertEqual(ClayverError.from(error("com.firebase.functions", 16)), .notAuthenticated)
        XCTAssertEqual(ClayverError.from(error("com.firebase.functions", 3, description: "bad hash")), .invalidArgument("bad hash"))
        XCTAssertEqual(ClayverError.from(error("com.firebase.functions", 14)), .network)
        XCTAssertEqual(ClayverError.from(error("com.firebase.functions", 13)).code, .internal)
    }

    func testStorageErrors() {
        XCTAssertEqual(ClayverError.from(error("FIRStorageErrorDomain", -13021)), .permissionDenied)
        XCTAssertEqual(ClayverError.from(error("FIRStorageErrorDomain", -13020)), .notAuthenticated)
        XCTAssertEqual(ClayverError.from(error("FIRStorageErrorDomain", -13040)), .cancelled)
        XCTAssertEqual(ClayverError.from(error("FIRStorageErrorDomain", -13030)), .network)
    }

    func testAuthErrors() {
        XCTAssertEqual(ClayverError.from(error("FIRAuthErrorDomain", 17020)), .network)
        XCTAssertEqual(ClayverError.from(error("FIRAuthErrorDomain", 17021)), .notAuthenticated)
        XCTAssertEqual(ClayverError.from(error("FIRAuthErrorDomain", 17006)), .permissionDenied)
    }

    func testURLErrors() {
        XCTAssertEqual(ClayverError.from(URLError(.notConnectedToInternet)), .network)
        XCTAssertEqual(ClayverError.from(error(NSURLErrorDomain, NSURLErrorCancelled)), .cancelled)
    }

    func testUnderlyingNetworkErrorWins() {
        let wrapped = error("FIRStorageErrorDomain", -13000, underlying: URLError(.timedOut))
        XCTAssertEqual(ClayverError.from(wrapped), .network)
    }

    func testPassThroughAndFallback() {
        XCTAssertEqual(ClayverError.from(ClayverError.notConfigured), .notConfigured)
        XCTAssertEqual(ClayverError.from(CancellationError()), .cancelled)
        XCTAssertEqual(ClayverError.from(error("com.example", 5, description: "boom")), .internal("boom"))
        XCTAssertEqual(ClayverError.from(error("com.example", 5, description: "Permission denied")), .permissionDenied)
    }

    func testStableCodes() {
        XCTAssertEqual(ClayverError.Code.allCases.map(\.rawValue), [
            "notConfigured", "notAuthenticated", "permissionDenied", "invalidArgument", "network",
            "attachmentTooLarge", "unsupportedAttachmentType", "cancelled", "internal",
        ])
        XCTAssertEqual(ClayverError.attachmentTooLarge(size: 1, limit: 0).code, .attachmentTooLarge)
        XCTAssertNotNil(ClayverError.network.errorDescription)
    }

    func testTranslatePreservesCancellation() {
        XCTAssertTrue(clayverTranslate(CancellationError()) is CancellationError)
        XCTAssertEqual(clayverTranslate(error("com.firebase", 1)) as? ClayverError, .permissionDenied)
    }
}
