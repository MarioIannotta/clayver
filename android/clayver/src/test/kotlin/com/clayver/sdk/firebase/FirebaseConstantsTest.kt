package com.clayver.sdk.firebase

import com.clayver.sdk.internal.ErrorCodes
import com.google.firebase.database.DatabaseError
import com.google.firebase.storage.StorageException
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * ErrorCodes duplicates Firebase's numeric error constants so it can be tested
 * without Android. This test (Android unit tests only) keeps them in sync.
 */
class FirebaseConstantsTest {
    @Test fun databaseErrorConstants() {
        assertEquals(DatabaseError.DATA_STALE, ErrorCodes.DB_DATA_STALE)
        assertEquals(DatabaseError.OPERATION_FAILED, ErrorCodes.DB_OPERATION_FAILED)
        assertEquals(DatabaseError.PERMISSION_DENIED, ErrorCodes.DB_PERMISSION_DENIED)
        assertEquals(DatabaseError.DISCONNECTED, ErrorCodes.DB_DISCONNECTED)
        assertEquals(DatabaseError.EXPIRED_TOKEN, ErrorCodes.DB_EXPIRED_TOKEN)
        assertEquals(DatabaseError.INVALID_TOKEN, ErrorCodes.DB_INVALID_TOKEN)
        assertEquals(DatabaseError.MAX_RETRIES, ErrorCodes.DB_MAX_RETRIES)
        assertEquals(DatabaseError.OVERRIDDEN_BY_SET, ErrorCodes.DB_OVERRIDDEN_BY_SET)
        assertEquals(DatabaseError.UNAVAILABLE, ErrorCodes.DB_UNAVAILABLE)
        assertEquals(DatabaseError.NETWORK_ERROR, ErrorCodes.DB_NETWORK_ERROR)
        assertEquals(DatabaseError.WRITE_CANCELED, ErrorCodes.DB_WRITE_CANCELED)
    }

    @Test fun storageErrorConstants() {
        assertEquals(StorageException.ERROR_UNKNOWN, ErrorCodes.STORAGE_UNKNOWN)
        assertEquals(StorageException.ERROR_OBJECT_NOT_FOUND, ErrorCodes.STORAGE_OBJECT_NOT_FOUND)
        assertEquals(StorageException.ERROR_NOT_AUTHENTICATED, ErrorCodes.STORAGE_NOT_AUTHENTICATED)
        assertEquals(StorageException.ERROR_NOT_AUTHORIZED, ErrorCodes.STORAGE_NOT_AUTHORIZED)
        assertEquals(StorageException.ERROR_RETRY_LIMIT_EXCEEDED, ErrorCodes.STORAGE_RETRY_LIMIT_EXCEEDED)
        assertEquals(StorageException.ERROR_CANCELED, ErrorCodes.STORAGE_CANCELED)
    }
}
