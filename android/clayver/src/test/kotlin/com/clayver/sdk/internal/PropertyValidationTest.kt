package com.clayver.sdk.internal

import com.clayver.sdk.Clayver
import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PropertyValidationTest {
    private fun invalid(props: Map<String, Any?>) {
        val e = assertThrows(ClayverException::class.java) { PropertyValidation.validate(props) }
        assertEquals(ClayverErrorCode.INVALID_ARGUMENT, e.code)
    }

    @Test fun acceptsStringsNumbersBooleans() {
        val out = PropertyValidation.validate(
            mapOf("name" to "Ada", "plan_tier" to "pro", "seats" to 3, "big" to 5_000_000_000L, "ratio" to 0.5f, "vip" to true, "A-b_9" to "x".repeat(1000)),
        )
        assertEquals("Ada", out["name"])
        assertEquals(3L, out["seats"])
        assertEquals(5_000_000_000L, out["big"])
        assertEquals(0.5, out["ratio"])
        assertEquals(true, out["vip"])
    }

    @Test fun preservesOrderAndAcceptsEmpty() {
        assertEquals(emptyMap<String, Any>(), PropertyValidation.validate(emptyMap()))
        assertEquals(listOf("b", "a"), PropertyValidation.validate(mapOf("b" to 1, "a" to 2)).keys.toList())
    }

    @Test fun rejectsBadKeys() {
        invalid(mapOf("" to "x"))
        invalid(mapOf("has space" to "x"))
        invalid(mapOf("dot.key" to "x"))
        invalid(mapOf("slash/key" to "x"))
        invalid(mapOf("k".repeat(65) to "x"))
        invalid(mapOf("émoji" to "x"))
        invalid(mapOf("_custom" to "x"))
        invalid(mapOf("\$name" to "x"))
    }

    @Test fun acceptsUserPropertyKeysWithStringValues() {
        val out = PropertyValidation.validate(mapOf(Clayver.UserProperty.NAME to "Ada", Clayver.UserProperty.UID to "u-42"))
        assertEquals("u-42", out[Clayver.UserProperty.UID])
        invalid(mapOf(Clayver.UserProperty.UID to 42))
    }

    @Test fun rejectsBadValues() {
        invalid(mapOf("long" to "x".repeat(1001)))
        invalid(mapOf("nil" to null))
        invalid(mapOf("nan" to Double.NaN))
        invalid(mapOf("inf" to Double.POSITIVE_INFINITY))
        invalid(mapOf("list" to listOf(1, 2)))
        invalid(mapOf("map" to mapOf("a" to 1)))
    }
}
