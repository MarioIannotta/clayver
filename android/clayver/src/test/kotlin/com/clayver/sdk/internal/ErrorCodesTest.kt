package com.clayver.sdk.internal

import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverErrorCode.CANCELLED
import com.clayver.sdk.ClayverErrorCode.INTERNAL
import com.clayver.sdk.ClayverErrorCode.INVALID_ARGUMENT
import com.clayver.sdk.ClayverErrorCode.NETWORK
import com.clayver.sdk.ClayverErrorCode.NOT_AUTHENTICATED
import com.clayver.sdk.ClayverErrorCode.PERMISSION_DENIED
import org.junit.Assert.assertEquals
import org.junit.Test

class ErrorCodesTest {
    @Test fun callableCodes() {
        assertEquals(NOT_AUTHENTICATED, ErrorCodes.fromCallableCode("UNAUTHENTICATED"))
        assertEquals(PERMISSION_DENIED, ErrorCodes.fromCallableCode("PERMISSION_DENIED"))
        assertEquals(PERMISSION_DENIED, ErrorCodes.fromCallableCode("permission-denied"))
        assertEquals(PERMISSION_DENIED, ErrorCodes.fromCallableCode("FAILED_PRECONDITION"))
        assertEquals(INVALID_ARGUMENT, ErrorCodes.fromCallableCode("INVALID_ARGUMENT"))
        assertEquals(INVALID_ARGUMENT, ErrorCodes.fromCallableCode("not-found"))
        assertEquals(NETWORK, ErrorCodes.fromCallableCode("UNAVAILABLE"))
        assertEquals(NETWORK, ErrorCodes.fromCallableCode("DEADLINE_EXCEEDED"))
        assertEquals(CANCELLED, ErrorCodes.fromCallableCode("CANCELLED"))
        assertEquals(INTERNAL, ErrorCodes.fromCallableCode("INTERNAL"))
        assertEquals(INTERNAL, ErrorCodes.fromCallableCode("UNKNOWN"))
    }

    @Test fun databaseCodes() {
        assertEquals(PERMISSION_DENIED, ErrorCodes.fromDatabaseErrorCode(-3))
        assertEquals(NETWORK, ErrorCodes.fromDatabaseErrorCode(-4))
        assertEquals(NETWORK, ErrorCodes.fromDatabaseErrorCode(-24))
        assertEquals(NOT_AUTHENTICATED, ErrorCodes.fromDatabaseErrorCode(-6))
        assertEquals(CANCELLED, ErrorCodes.fromDatabaseErrorCode(-25))
        assertEquals(INTERNAL, ErrorCodes.fromDatabaseErrorCode(-999))
    }

    @Test fun databaseMessages() {
        assertEquals(PERMISSION_DENIED, ErrorCodes.fromDatabaseMessage("Firebase Database error: Permission denied"))
        assertEquals(NETWORK, ErrorCodes.fromDatabaseMessage("Client is offline"))
        assertEquals(NETWORK, ErrorCodes.fromDatabaseMessage("The operation had to be aborted due to a network error"))
        assertEquals(INTERNAL, ErrorCodes.fromDatabaseMessage(null))
        assertEquals(INTERNAL, ErrorCodes.fromDatabaseMessage("Something odd"))
    }

    @Test fun storageCodes() {
        assertEquals(NOT_AUTHENTICATED, ErrorCodes.fromStorageErrorCode(-13020))
        assertEquals(PERMISSION_DENIED, ErrorCodes.fromStorageErrorCode(-13021))
        assertEquals(NETWORK, ErrorCodes.fromStorageErrorCode(-13030))
        assertEquals(CANCELLED, ErrorCodes.fromStorageErrorCode(-13040))
        assertEquals(INTERNAL, ErrorCodes.fromStorageErrorCode(-13000))
    }

    @Test fun wireNamesMatchContract() {
        assertEquals(
            listOf("notConfigured", "notAuthenticated", "permissionDenied", "invalidArgument", "network",
                "attachmentTooLarge", "unsupportedAttachmentType", "cancelled", "internal"),
            ClayverErrorCode.entries.map { it.wireName },
        )
        ClayverErrorCode.entries.forEach { assertEquals(it, ClayverErrorCode.fromWireName(it.wireName)) }
    }
}
