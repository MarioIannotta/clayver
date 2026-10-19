package com.clayver.sdk.internal

import java.security.SecureRandom
import java.util.Random

internal object DeviceIds {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

    /** A random id matching `^[A-Za-z0-9_-]{8,64}$` (22 chars ≈ 132 bits). */
    fun generate(random: Random = SecureRandom(), length: Int = 22): String =
        buildString(length) { repeat(length) { append(ALPHABET[random.nextInt(ALPHABET.length)]) } }

    /** Client-side id for optimistic sends (≤ 64 chars). */
    fun clientMessageId(random: Random = SecureRandom()): String = "a_" + generate(random, 20)
}
