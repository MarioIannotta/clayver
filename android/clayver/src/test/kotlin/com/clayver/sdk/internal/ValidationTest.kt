package com.clayver.sdk.internal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ValidationTest {
    @Test fun validatesProjectAndDeviceIds() {
        assertTrue(Validation.isValidProjectId("default"))
        assertTrue(Validation.isValidProjectId("my-app-2"))
        assertFalse(Validation.isValidProjectId("Default"))
        assertFalse(Validation.isValidProjectId(""))
        assertFalse(Validation.isValidProjectId("a".repeat(41)))
        assertFalse(Validation.isValidProjectId("a/b"))
        repeat(50) { assertTrue(Validation.isValidDeviceId(DeviceIds.generate())) }
        assertFalse(Validation.isValidDeviceId("short"))
        assertTrue(DeviceIds.clientMessageId().length <= MessageRules.MAX_CLIENT_MESSAGE_ID_LENGTH)
    }

    @Test fun shortStringsAreCapped() {
        assertEquals(64, Validation.shortString("x".repeat(100))!!.length)
        assertEquals(null, Validation.shortString("   "))
        assertEquals("1.2.3", Validation.shortString(" 1.2.3 "))
    }
}
