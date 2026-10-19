package com.clayver.sdk.internal

import com.clayver.sdk.ClayverErrorCode
import java.util.Locale

/**
 * Pure mappings from Firebase error identifiers to [ClayverErrorCode]. The
 * Android-specific glue in FirebaseErrors.kt extracts these identifiers from
 * the Firebase exception classes.
 */
internal object ErrorCodes {

    /** `FirebaseFunctionsException.Code.name` or the callable wire code (`permission-denied`). */
    fun fromCallableCode(code: String): ClayverErrorCode =
        when (code.uppercase(Locale.ROOT).replace('-', '_')) {
            "UNAUTHENTICATED" -> ClayverErrorCode.NOT_AUTHENTICATED
            "PERMISSION_DENIED", "FAILED_PRECONDITION" -> ClayverErrorCode.PERMISSION_DENIED
            "INVALID_ARGUMENT", "NOT_FOUND", "OUT_OF_RANGE", "ALREADY_EXISTS" -> ClayverErrorCode.INVALID_ARGUMENT
            "UNAVAILABLE", "DEADLINE_EXCEEDED", "RESOURCE_EXHAUSTED" -> ClayverErrorCode.NETWORK
            "CANCELLED", "ABORTED" -> ClayverErrorCode.CANCELLED
            else -> ClayverErrorCode.INTERNAL
        }

    // Values of com.google.firebase.database.DatabaseError constants.
    const val DB_DATA_STALE: Int = -1
    const val DB_OPERATION_FAILED: Int = -2
    const val DB_PERMISSION_DENIED: Int = -3
    const val DB_DISCONNECTED: Int = -4
    const val DB_EXPIRED_TOKEN: Int = -6
    const val DB_INVALID_TOKEN: Int = -7
    const val DB_MAX_RETRIES: Int = -8
    const val DB_OVERRIDDEN_BY_SET: Int = -9
    const val DB_UNAVAILABLE: Int = -10
    const val DB_NETWORK_ERROR: Int = -24
    const val DB_WRITE_CANCELED: Int = -25

    fun fromDatabaseErrorCode(code: Int): ClayverErrorCode = when (code) {
        DB_PERMISSION_DENIED -> ClayverErrorCode.PERMISSION_DENIED
        DB_EXPIRED_TOKEN, DB_INVALID_TOKEN -> ClayverErrorCode.NOT_AUTHENTICATED
        DB_DISCONNECTED, DB_NETWORK_ERROR, DB_UNAVAILABLE, DB_MAX_RETRIES -> ClayverErrorCode.NETWORK
        DB_WRITE_CANCELED, DB_OVERRIDDEN_BY_SET -> ClayverErrorCode.CANCELLED
        else -> ClayverErrorCode.INTERNAL
    }

    /**
     * `DatabaseException`s thrown by write/get Tasks carry no code, only the
     * DatabaseError message ("Firebase Database error: Permission denied").
     */
    fun fromDatabaseMessage(message: String?): ClayverErrorCode {
        val m = message?.lowercase(Locale.ROOT) ?: return ClayverErrorCode.INTERNAL
        return when {
            "permission denied" in m || "permission_denied" in m -> ClayverErrorCode.PERMISSION_DENIED
            "auth token" in m || "invalid token" in m || "expired" in m -> ClayverErrorCode.NOT_AUTHENTICATED
            "network" in m || "disconnected" in m || "offline" in m || "unavailable" in m ||
                "client is offline" in m -> ClayverErrorCode.NETWORK
            "cancel" in m -> ClayverErrorCode.CANCELLED
            else -> ClayverErrorCode.INTERNAL
        }
    }

    // Values of com.google.firebase.storage.StorageException constants.
    const val STORAGE_UNKNOWN: Int = -13000
    const val STORAGE_OBJECT_NOT_FOUND: Int = -13010
    const val STORAGE_BUCKET_NOT_FOUND: Int = -13011
    const val STORAGE_PROJECT_NOT_FOUND: Int = -13012
    const val STORAGE_QUOTA_EXCEEDED: Int = -13013
    const val STORAGE_NOT_AUTHENTICATED: Int = -13020
    const val STORAGE_NOT_AUTHORIZED: Int = -13021
    const val STORAGE_RETRY_LIMIT_EXCEEDED: Int = -13030
    const val STORAGE_INVALID_CHECKSUM: Int = -13031
    const val STORAGE_CANCELED: Int = -13040

    fun fromStorageErrorCode(code: Int): ClayverErrorCode = when (code) {
        STORAGE_NOT_AUTHENTICATED -> ClayverErrorCode.NOT_AUTHENTICATED
        // Storage rules reject oversize/disallowed uploads as "not authorized";
        // the SDK validates size and type up front, so this is a real denial.
        STORAGE_NOT_AUTHORIZED -> ClayverErrorCode.PERMISSION_DENIED
        STORAGE_RETRY_LIMIT_EXCEEDED -> ClayverErrorCode.NETWORK
        STORAGE_CANCELED -> ClayverErrorCode.CANCELLED
        STORAGE_OBJECT_NOT_FOUND -> ClayverErrorCode.INVALID_ARGUMENT
        else -> ClayverErrorCode.INTERNAL
    }
}
