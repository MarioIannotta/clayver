import Foundation
import Security
import os

let clayverLog = Logger(subsystem: "com.clayver.sdk", category: "Clayver")

/// Stores the per-installation device id (`^[A-Za-z0-9_-]{8,64}$`) in the Keychain.
enum DeviceIdStore {
    static let service = "com.clayver.sdk"
    private static let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")

    static func deviceId(appName: String) -> String {
        let account = "deviceId.\(appName)"
        if let existing = read(account: account), ClayverValidation.isValidDeviceId(existing) {
            return existing
        }
        // Fallback for environments without a usable Keychain (e.g. some test hosts).
        let defaultsKey = "\(service).\(account)"
        if let fallback = UserDefaults.standard.string(forKey: defaultsKey), ClayverValidation.isValidDeviceId(fallback) {
            return fallback
        }
        let id = generate()
        if !save(id, account: account) {
            clayverLog.warning("Keychain unavailable; storing the Clayver device id in UserDefaults.")
            UserDefaults.standard.set(id, forKey: defaultsKey)
        }
        return id
    }

    static func generate(length: Int = 32) -> String {
        var generator = SystemRandomNumberGenerator()
        return String((0..<length).map { _ in alphabet[Int(generator.next(upperBound: UInt(alphabet.count)))] })
    }

    private static func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static func read(account: String) -> String? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func save(_ value: String, account: String) -> Bool {
        SecItemDelete(baseQuery(account: account) as CFDictionary)
        var query = baseQuery(account: account)
        query[kSecValueData as String] = Data(value.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }
}

/// Remembers the last FCM token handed to Clayver so the device can be re-registered
/// when a different Firebase user signs in.
enum PushTokenStore {
    private static func key(_ appName: String) -> String { "com.clayver.sdk.fcmToken.\(appName)" }

    static func token(appName: String) -> String? {
        UserDefaults.standard.string(forKey: key(appName))
    }

    static func setToken(_ token: String?, appName: String) {
        if let token {
            UserDefaults.standard.set(token, forKey: key(appName))
        } else {
            UserDefaults.standard.removeObject(forKey: key(appName))
        }
    }
}
