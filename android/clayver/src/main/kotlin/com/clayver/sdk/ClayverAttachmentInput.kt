package com.clayver.sdk

import com.clayver.sdk.internal.AttachmentRules
import java.io.ByteArrayInputStream
import java.io.InputStream

/**
 * A file to send with [Clayver.sendMessage].
 *
 * Build one with [fromBytes], [fromStream] or, on Android, `ClayverAttachmentInput.fromUri(context, uri)`.
 * Only images are accepted (JPEG, PNG, GIF, WebP, HEIC). Before uploading, the
 * SDK re-encodes every image as a JPEG of at most 300 KB (longest side at most
 * 1600 px), so the stored file is always `image/jpeg` with a `.jpg` name.
 * Source images may be up to 30 MiB.
 */
public class ClayverAttachmentInput private constructor(
    public val fileName: String,
    public val contentType: String,
    /** Size in bytes, or null when unknown (the stream is then measured while reading). */
    public val size: Long?,
    public val width: Int?,
    public val height: Int?,
    /** True when the data is already a compressed JPEG within the upload limit (see `fromUri`). */
    internal val isPrepared: Boolean = false,
    internal val openStream: () -> InputStream,
) {
    public companion object {
        public fun fromBytes(
            bytes: ByteArray,
            fileName: String,
            contentType: String,
            width: Int? = null,
            height: Int? = null,
        ): ClayverAttachmentInput = ClayverAttachmentInput(
            fileName, contentType, bytes.size.toLong(), width, height,
        ) { ByteArrayInputStream(bytes) }

        public fun fromStream(
            fileName: String,
            contentType: String,
            size: Long?,
            width: Int? = null,
            height: Int? = null,
            open: () -> InputStream,
        ): ClayverAttachmentInput = ClayverAttachmentInput(fileName, contentType, size, width, height, openStream = open)

        /** An already compressed JPEG; uploaded as is. */
        internal fun prepared(bytes: ByteArray, fileName: String, width: Int, height: Int): ClayverAttachmentInput =
            ClayverAttachmentInput(
                fileName, AttachmentRules.UPLOAD_CONTENT_TYPE, bytes.size.toLong(), width, height,
                isPrepared = true,
                openStream = { ByteArrayInputStream(bytes) },
            )
    }

    /**
     * Fails fast on the declared type and size: an input the SDK still has to
     * compress may be up to [AttachmentRules.MAX_SOURCE_IMAGE_BYTES].
     */
    internal fun validateDeclared(): String = AttachmentRules.validate(
        contentType, fileName, size,
        if (isPrepared) AttachmentRules.MAX_SIZE_BYTES else AttachmentRules.MAX_SOURCE_IMAGE_BYTES,
    )

    override fun toString(): String = "ClayverAttachmentInput($fileName, $contentType, size=$size)"
}
