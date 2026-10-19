import Foundation
import FirebaseDatabase
import FirebaseStorage

/// Holds a `.value` observer registration so it can be removed from `onTermination`,
/// even when termination races with registration.
final class ObserverRegistration: @unchecked Sendable {
    private let lock = NSLock()
    private var query: DatabaseQuery?
    private var handle: DatabaseHandle?
    private var removed = false

    func set(query: DatabaseQuery, handle: DatabaseHandle) {
        lock.lock()
        if removed {
            lock.unlock()
            query.removeObserver(withHandle: handle)
            return
        }
        self.query = query
        self.handle = handle
        lock.unlock()
    }

    func remove() {
        lock.lock()
        removed = true
        let query = self.query
        let handle = self.handle
        self.query = nil
        self.handle = nil
        lock.unlock()
        if let query, let handle { query.removeObserver(withHandle: handle) }
    }
}

/// A one-shot `.value` read that honours task cancellation (unlike `observeSingleEvent`).
final class SingleRead: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<DataSnapshot, Error>?
    private var query: DatabaseQuery?
    private var handle: DatabaseHandle?
    private var cancelled = false

    static func read(_ query: DatabaseQuery) async throws -> DataSnapshot {
        let reader = SingleRead()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                reader.start(query, continuation: continuation)
            }
        } onCancel: {
            reader.cancel()
        }
    }

    private func start(_ query: DatabaseQuery, continuation: CheckedContinuation<DataSnapshot, Error>) {
        lock.lock()
        if cancelled {
            lock.unlock()
            continuation.resume(throwing: CancellationError())
            return
        }
        self.continuation = continuation
        self.query = query
        lock.unlock()

        let handle = query.observe(.value, with: { snapshot in
            self.finish(.success(snapshot))
        }, withCancel: { error in
            self.finish(.failure(error))
        })

        lock.lock()
        if self.continuation == nil {
            // Finished synchronously (cached value) or cancelled meanwhile.
            lock.unlock()
            query.removeObserver(withHandle: handle)
            return
        }
        self.handle = handle
        lock.unlock()
    }

    private func finish(_ result: Result<DataSnapshot, Error>) {
        lock.lock()
        let continuation = self.continuation
        self.continuation = nil
        let query = self.query
        let handle = self.handle
        self.handle = nil
        lock.unlock()
        if let query, let handle { query.removeObserver(withHandle: handle) }
        continuation?.resume(with: result)
    }

    private func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
        finish(.failure(CancellationError()))
    }
}

/// Uploads data and cancels the `StorageUploadTask` when the calling task is cancelled.
enum CancellableUpload {
    private final class Holder: @unchecked Sendable {
        private let lock = NSLock()
        private var task: StorageUploadTask?
        private var cancelled = false

        func set(_ task: StorageUploadTask) {
            lock.lock()
            self.task = task
            let cancelled = self.cancelled
            lock.unlock()
            if cancelled { task.cancel() }
        }

        func cancel() {
            lock.lock()
            cancelled = true
            let task = self.task
            lock.unlock()
            task?.cancel()
        }
    }

    static func put(_ data: Data, to ref: StorageReference, metadata: StorageMetadata) async throws -> StorageMetadata {
        let holder = Holder()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<StorageMetadata, Error>) in
                let task = ref.putData(data, metadata: metadata) { metadata, error in
                    if let metadata {
                        continuation.resume(returning: metadata)
                    } else {
                        continuation.resume(throwing: error ?? ClayverError.internal("Upload failed."))
                    }
                }
                holder.set(task)
            }
        } onCancel: {
            holder.cancel()
        }
    }
}

extension DataSnapshot {
    /// Direct children as `(key, value)` pairs, in snapshot order.
    var childPairs: [(key: String, value: Any?)] {
        children.compactMap { child -> (key: String, value: Any?)? in
            guard let snapshot = child as? DataSnapshot else { return nil }
            return (snapshot.key, snapshot.value)
        }
    }
}
