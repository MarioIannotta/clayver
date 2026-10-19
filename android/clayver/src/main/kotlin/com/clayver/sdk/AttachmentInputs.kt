package com.clayver.sdk

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.clayver.sdk.internal.AttachmentRules
import com.clayver.sdk.internal.ImageCompressor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException

/**
 * Builds an attachment from an image content Uri returned by the Photo Picker.
 * Reads the image (up to 30 MiB) and compresses it right away, off the main
 * thread, to a JPEG of at most 300 KB with its longest side at most 1600 px,
 * so the returned input's size and dimensions are exactly what is uploaded.
 * Throws `unsupportedAttachmentType` for anything that is not an image.
 */
public suspend fun ClayverAttachmentInput.Companion.fromUri(context: Context, uri: Uri): ClayverAttachmentInput {
    val resolver = context.applicationContext.contentResolver
    val (fileName, source) = withContext(Dispatchers.IO) {
        var name: String? = null
        var size: Long? = null
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                val nameIndex = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = c.getColumnIndex(OpenableColumns.SIZE)
                if (nameIndex >= 0 && !c.isNull(nameIndex)) name = c.getString(nameIndex)
                if (sizeIndex >= 0 && !c.isNull(sizeIndex)) size = c.getLong(sizeIndex).takeIf { it >= 0 }
            }
        }
        val fileName = name ?: uri.lastPathSegment ?: "photo"
        AttachmentRules.validate(resolver.getType(uri), fileName, size, AttachmentRules.MAX_SOURCE_IMAGE_BYTES)
        val stream = resolver.openInputStream(uri) ?: throw IOException("Cannot open $uri")
        fileName to AttachmentRules.readBounded(stream, AttachmentRules.MAX_SOURCE_IMAGE_BYTES)
    }
    if (source.isEmpty()) throw ClayverException.invalidArgument("The attachment is empty.")
    val image = withContext(Dispatchers.Default) { ImageCompressor.compress(source) }
    return ClayverAttachmentInput.prepared(image.bytes, AttachmentRules.jpegFileName(fileName), image.width, image.height)
}
