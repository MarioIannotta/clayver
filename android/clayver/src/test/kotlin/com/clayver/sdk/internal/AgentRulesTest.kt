package com.clayver.sdk.internal

import com.clayver.sdk.ClayverAgentRole
import com.clayver.sdk.ClayverConversationStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentRulesTest {
    @Test fun readsRoleForTheConfiguredWorkspaceOnly() {
        val claims = mapOf<String, Any?>(
            "clayver_cid" to "v_abc",
            "clayver_roles" to mapOf("default" to "admin", "eu" to "agent", "x" to "owner"),
        )
        assertEquals(ClayverAgentRole.ADMIN, AgentRules.roleFromClaims(claims, "default"))
        assertEquals(ClayverAgentRole.AGENT, AgentRules.roleFromClaims(claims, "eu"))
        assertNull(AgentRules.roleFromClaims(claims, "other"))
        assertNull("unknown role values are not roles", AgentRules.roleFromClaims(claims, "x"))
    }

    @Test fun noRoleWithoutAWellFormedClaim() {
        assertNull(AgentRules.roleFromClaims(null, "default"))
        assertNull(AgentRules.roleFromClaims(emptyMap(), "default"))
        assertNull(AgentRules.roleFromClaims(mapOf("clayver_roles" to "admin"), "default"))
        assertNull(AgentRules.roleFromClaims(mapOf("clayver_roles" to mapOf("default" to true)), "default"))
        assertNull(AgentRules.roleFromClaims(mapOf("clayver_roles" to mapOf("default" to null)), "default"))
    }

    @Test fun statusOrderBoundsMatchTheSchema() {
        assertEquals("open_", AgentRules.statusOrderStart(ClayverConversationStatus.OPEN))
        assertEquals("open_~", AgentRules.statusOrderEnd(ClayverConversationStatus.OPEN))
        assertEquals("closed_", AgentRules.statusOrderStart(ClayverConversationStatus.CLOSED))
        assertEquals("closed_~", AgentRules.statusOrderEnd(ClayverConversationStatus.CLOSED))
        // A real key sorts inside the bounds and other statuses outside them.
        val key = "open_" + "1700000000000".padStart(15, '0')
        assertTrue(key > "open_" && key < "open_~")
        assertTrue("closed_000001700000000000" < "open_")
    }

    @Test fun senderNameFallsBackAndIsCapped() {
        assertEquals("Ada", AgentRules.senderName(" Ada ", "Profile", "x@y.z"))
        assertEquals("Profile", AgentRules.senderName("  ", "Profile", "x@y.z"))
        assertEquals("grace", AgentRules.senderName(null, null, "grace@example.com"))
        assertNull(AgentRules.senderName(null, "", null))
        assertNull(AgentRules.senderName(null, null, "@example.com"))
        assertEquals(80, AgentRules.senderName("n".repeat(200), null, null)!!.length)
    }

    @Test fun shortCustomerId() {
        assertEquals("1a2b3c", AgentRules.shortCustomerId("1a2b3c4d5e"))
        assertEquals("Xy9", AgentRules.shortCustomerId("Xy9"))
        assertEquals("AbCdEf", AgentRules.shortCustomerId("AbCdEfGhIj"))
    }

    @Test fun agentPaths() {
        val p = Paths("default")
        assertEquals("clayver/projects/default/agents/u1", p.agent("u1"))
        assertEquals("clayver/projects/default/devices/agents/u1/dev12345", p.agentDevice("u1", "dev12345"))
    }
}
