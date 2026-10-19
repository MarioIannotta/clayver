import Foundation

extension NSLock {
    /// Runs `body` while holding the lock. Being synchronous, it is safe to call from async code,
    /// where `lock()`/`unlock()` are unavailable in Swift 6 (they must not straddle a suspension
    /// point). Foundation's own `withLock` needs iOS 16.
    func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock()
        defer { unlock() }
        return try body()
    }
}
