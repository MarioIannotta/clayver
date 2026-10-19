package com.clayver.sdk.internal

import com.clayver.sdk.Clayver
import com.clayver.sdk.ClayverException

/** Validation of `users/{cid}/properties/{key}` as defined in database.schema.md. */
internal object PropertyValidation {
    private val KEY = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    const val MAX_STRING_LENGTH: Int = 1000

    /** A custom key, or one of [Clayver.UserProperty]. */
    fun isValidKey(key: String): Boolean = key in Clayver.UserProperty.ALL || KEY.matches(key)

    /**
     * Returns the map to write, with numbers normalised to Long/Double (the
     * types the Realtime Database stores), or throws `invalidArgument`.
     */
    fun validate(properties: Map<String, Any?>): Map<String, Any> {
        val out = LinkedHashMap<String, Any>(properties.size)
        for ((key, value) in properties) {
            if (!isValidKey(key)) {
                throw ClayverException.invalidArgument(
                    "Invalid property key \"$key\": use 1-64 characters from A-Z, a-z, 0-9, '_' and '-', " +
                        "not starting with '_' (reserved for Clayver.UserProperty).",
                )
            }
            if (key in Clayver.UserProperty.ALL && value !is String) {
                throw ClayverException.invalidArgument("Property \"$key\" must be a string.")
            }
            out[key] = normalizeValue(key, value)
        }
        return out
    }

    private fun normalizeValue(key: String, value: Any?): Any = when (value) {
        null -> throw ClayverException.invalidArgument("Property \"$key\" is null; values must be a string, number or boolean.")
        is String -> {
            if (value.length > MAX_STRING_LENGTH) {
                throw ClayverException.invalidArgument("Property \"$key\" is longer than $MAX_STRING_LENGTH characters.")
            }
            value
        }
        is Boolean -> value
        is Byte, is Short, is Int, is Long -> (value as Number).toLong()
        is Float, is Double -> {
            val d = (value as Number).toDouble()
            if (d.isNaN() || d.isInfinite()) {
                throw ClayverException.invalidArgument("Property \"$key\" must be a finite number.")
            }
            d
        }
        else -> throw ClayverException.invalidArgument(
            "Property \"$key\" has unsupported type ${value::class.java.simpleName}; use a string, number or boolean.",
        )
    }
}
