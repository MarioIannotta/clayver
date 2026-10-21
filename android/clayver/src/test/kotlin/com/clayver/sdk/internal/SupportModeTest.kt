package com.clayver.sdk.internal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class SupportModeTest {
    @Test
    fun keyIsPerWorkspaceAndUser() {
        assertEquals("supportMode.p.u1", SupportModeStore.key("u1", "p"))
        assertEquals("supportMode.default.u1", SupportModeStore.key("u1", null))
        assertNotEquals(SupportModeStore.key("u1", "p"), SupportModeStore.key("u2", "p"))
    }

    @Test
    fun unknownOrMissingValuesAreCustomer() {
        assertEquals(SupportMode.CUSTOMER, SupportModeStore.parse(null))
        assertEquals(SupportMode.CUSTOMER, SupportModeStore.parse("admin"))
        assertEquals(SupportMode.AGENT, SupportModeStore.parse("AGENT"))
    }
}
