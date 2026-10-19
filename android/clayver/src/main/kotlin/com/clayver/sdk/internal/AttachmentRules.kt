package com.clayver.sdk.internal

import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverException
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.Locale

/**
 * Storage limits from database.schema.md ("Storage layout"). Only images are
 * accepted, and the SDK re-encodes every image as a JPEG of at most
 * [MAX_SIZE_BYTES] before uploading it (see ImageCompressor).
 */
internal object AttachmentRules {
    /** Largest object the Storage rules accept: 300 KB. */
    const val MAX_SIZE_BYTES: Long = 300L * 1024
    const val MAX_SIZE_LABEL: String = "300 KB"

    /**
     * Largest source image read before compression. Inputs that the SDK still
     * has to compress are checked against this, not [MAX_SIZE_BYTES].
     */
    const val MAX_SOURCE_IMAGE_BYTES: Long = 30L * 1024 * 1024
    const val MAX_FILE_NAME_LENGTH: Int = 200

    /** Content type of every uploaded attachment once compressed. */
    const val UPLOAD_CONTENT_TYPE: String = "image/jpeg"

    val ALLOWED_CONTENT_TYPES: Set<String> = setOf(
        "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic",
    )

    private val EXTENSIONS = mapOf(
        "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "png" to "image/png", "gif" to "image/gif",
        "webp" to "image/webp", "heic" to "image/heic", "heif" to "image/heic",
    )

    private val ALIASES = mapOf(
        "image/jpg" to "image/jpeg",
        "image/pjpeg" to "image/jpeg",
        "image/heif" to "image/heic",
    )

    /**
     * Lower-cases, strips parameters (`text/plain; charset=utf-8`), resolves
     * common aliases, and falls back to the file extension when the type is
     * missing or generic. Returns null if nothing usable is found.
     */
    fun normalizeContentType(contentType: String?, fileName: String?): String? {
        val raw = contentType?.substringBefore(';')?.trim()?.lowercase(Locale.ROOT)?.takeIf { it.isNotEmpty() }
        val resolved = raw?.let { ALIASES[it] ?: it }
        if (resolved != null && resolved != "application/octet-stream") return resolved
        val ext = fileName?.substringAfterLast('.', "")?.lowercase(Locale.ROOT)
        return ext?.let { EXTENSIONS[it] } ?: resolved
    }

    /**
     * Throws `unsupportedAttachmentType` / `attachmentTooLarge` / `invalidArgument`. Returns the normalised type.
     * [maxSize] is [MAX_SIZE_BYTES] for data about to be uploaded, or [MAX_SOURCE_IMAGE_BYTES]
     * for an image the SDK will still compress.
     */
    fun validate(contentType: String?, fileName: String?, size: Long?, maxSize: Long = MAX_SIZE_BYTES): String {
        val type = normalizeContentType(contentType, fileName)
        if (type == null || type !in ALLOWED_CONTENT_TYPES) {
            throw ClayverException(
                ClayverErrorCode.UNSUPPORTED_ATTACHMENT_TYPE,
                "Attachments of type ${type ?: "unknown"} are not supported. Allowed: ${ALLOWED_CONTENT_TYPES.joinToString()}.",
            )
        }
        if (size != null) {
            if (size <= 0L) throw ClayverException.invalidArgument("The attachment is empty.")
            if (size > maxSize) throw tooLarge(size, maxSize)
        }
        return type
    }

    fun tooLarge(size: Long?, maxSize: Long = MAX_SIZE_BYTES): ClayverException = ClayverException(
        ClayverErrorCode.ATTACHMENT_TOO_LARGE,
        "The attachment is ${size?.let { "$it bytes" } ?: "too large"}; the limit is ${limitLabel(maxSize)}.",
    )

    private fun limitLabel(maxSize: Long): String =
        if (maxSize >= 1024L * 1024 && maxSize % (1024L * 1024) == 0L) "${maxSize / (1024L * 1024)} MiB" else "${maxSize / 1024} KB"

    /** Replaces the extension with `.jpg` (the format every attachment is uploaded in). */
    fun jpegFileName(name: String?): String {
        val base = sanitizeFileName(name)
        val dot = base.lastIndexOf('.')
        val stem = (if (dot > 0) base.substring(0, dot) else base).trimEnd('.').ifEmpty { "photo" }
        return sanitizeFileName("$stem.jpg")
    }

    /**
     * Makes a file name safe to use as a single Storage path segment: removes
     * directory parts and control characters, and caps it at 200 characters
     * while keeping the extension.
     */
    fun sanitizeFileName(name: String?): String {
        val base = name.orEmpty().substringAfterLast('/').substringAfterLast('\\')
        val cleaned = base.filter { it.code >= 0x20 && it.code != 0x7F && it !in "#[]*?" }.trim().trim('.')
        val safe = cleaned.ifEmpty { "file" }
        if (safe.length <= MAX_FILE_NAME_LENGTH) return safe
        val ext = safe.substringAfterLast('.', "").take(16)
        return if (ext.isNotEmpty() && ext.length < safe.length) {
            safe.take(MAX_FILE_NAME_LENGTH - ext.length - 1).trimEnd('.') + "." + ext
        } else {
            safe.take(MAX_FILE_NAME_LENGTH)
        }
    }

    /** Reads at most [max] bytes ([MAX_SIZE_BYTES] by default); throws `attachmentTooLarge` if the stream is longer. */
    fun readBounded(stream: InputStream, max: Long = MAX_SIZE_BYTES): ByteArray {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        stream.use {
            while (true) {
                val n = it.read(buffer)
                if (n < 0) break
                total += n
                if (total > max) throw tooLarge(null, max)
                out.write(buffer, 0, n)
            }
        }
        return out.toByteArray()
    }
}

/** Pure sizing math for image compression (unit-testable, no Android types). */
internal object ImageSizing {
    /** Longest side of a compressed image, in pixels. */
    const val MAX_DIMENSION: Int = 1600

    /** Below this longest side the SDK gives up shrinking and reports `attachmentTooLarge`. */
    const val MIN_DIMENSION: Int = 160

    /** JPEG qualities tried, in order, at each size. */
    val JPEG_QUALITIES: List<Int> = listOf(85, 75, 65, 55, 45)

    /** Factor applied to the longest side when no quality fits. */
    const val SHRINK_FACTOR: Double = 0.75

    /**
     * Largest power-of-two sample size that still decodes the image with its
     * longest side at least [maxDimension] (the exact downscale happens after decoding).
     */
    fun inSampleSize(width: Int, height: Int, maxDimension: Int = MAX_DIMENSION): Int {
        val longest = maxOf(width, height)
        var sample = 1
        while (longest / (sample * 2) >= maxDimension) sample *= 2
        return sample
    }

    /** Scales (width, height) down so the longest side is at most [maxDimension]; never scales up. */
    fun fitWithin(width: Int, height: Int, maxDimension: Int = MAX_DIMENSION): Pair<Int, Int> {
        val longest = maxOf(width, height)
        if (longest <= maxDimension || longest <= 0) return width to height
        val scale = maxDimension.toDouble() / longest
        return maxOf(1, Math.round(width * scale).toInt()) to maxOf(1, Math.round(height * scale).toInt())
    }

    /** The next, smaller longest side to try, or null once below [MIN_DIMENSION]. */
    fun nextDimension(currentLongest: Int): Int? {
        val next = (currentLongest * SHRINK_FACTOR).toInt()
        return next.takeIf { it >= MIN_DIMENSION }
    }
}

/** Message validation from database.schema.md (`messages/...`). */
internal object MessageRules {
    const val MAX_TEXT_LENGTH: Int = 4000
    const val MAX_CLIENT_MESSAGE_ID_LENGTH: Int = 64

    /** Trims; returns null for blank text; throws when too long. */
    fun normalizeText(text: String?): String? {
        val trimmed = text?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        if (trimmed.length > MAX_TEXT_LENGTH) {
            throw ClayverException.invalidArgument("Messages are limited to $MAX_TEXT_LENGTH characters.")
        }
        return trimmed
    }
}
