package com.clayver.sdk.internal

internal object Validation {
    private val PROJECT_ID = Regex("^[a-z0-9-]{1,40}$")
    private val DEVICE_ID = Regex("^[A-Za-z0-9_-]{8,64}$")
    const val MAX_PUSH_TOKEN_LENGTH: Int = 4096
    const val MAX_SHORT_STRING: Int = 64

    fun isValidProjectId(value: String): Boolean = PROJECT_ID.matches(value)
    fun isValidDeviceId(value: String): Boolean = DEVICE_ID.matches(value)

    /** Trims and caps optional device metadata (`appVersion`, `sdkVersion`, `locale`) to 64 chars. */
    fun shortString(value: String?): String? =
        value?.trim()?.takeIf { it.isNotEmpty() }?.take(MAX_SHORT_STRING)
}
