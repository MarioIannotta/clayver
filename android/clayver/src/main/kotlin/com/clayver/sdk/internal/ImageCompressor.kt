package com.clayver.sdk.internal

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.media.ExifInterface
import android.os.Build
import com.clayver.sdk.ClayverAttachmentInput
import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

/** A JPEG produced by [ImageCompressor]. */
internal class CompressedImage(val bytes: ByteArray, val width: Int, val height: Int)

/**
 * Re-encodes any decodable image (JPEG, PNG, GIF, WebP, HEIC on API 28+) as a
 * JPEG of at most [AttachmentRules.MAX_SIZE_BYTES]: downscale so the longest
 * side is at most [ImageSizing.MAX_DIMENSION], apply the EXIF orientation,
 * then step the quality down and keep shrinking until the result fits.
 *
 * CPU and memory heavy: call it off the main thread.
 */
internal object ImageCompressor {
    fun compress(
        source: ByteArray,
        maxBytes: Long = AttachmentRules.MAX_SIZE_BYTES,
        maxDimension: Int = ImageSizing.MAX_DIMENSION,
    ): CompressedImage {
        try {
            return compressOrThrow(source, maxBytes, maxDimension)
        } catch (e: OutOfMemoryError) {
            throw ClayverException(ClayverErrorCode.ATTACHMENT_TOO_LARGE, "The image is too large to process.", e)
        }
    }

    private fun compressOrThrow(source: ByteArray, maxBytes: Long, maxDimension: Int): CompressedImage {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(source, 0, source.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw undecodable()

        val options = BitmapFactory.Options().apply {
            inSampleSize = ImageSizing.inSampleSize(bounds.outWidth, bounds.outHeight, maxDimension)
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        var bitmap = BitmapFactory.decodeByteArray(source, 0, source.size, options) ?: throw undecodable()
        try {
            bitmap = replace(bitmap, scaleToFit(bitmap, maxDimension))
            bitmap = replace(bitmap, applyOrientation(bitmap, exifOrientation(source)))
            bitmap = replace(bitmap, flattenAlpha(bitmap))

            var longest = maxOf(bitmap.width, bitmap.height)
            while (true) {
                for (quality in ImageSizing.JPEG_QUALITIES) {
                    val out = encode(bitmap, quality)
                    if (out.size <= maxBytes) return CompressedImage(out, bitmap.width, bitmap.height)
                }
                val next = ImageSizing.nextDimension(longest) ?: break
                bitmap = replace(bitmap, scaleToFit(bitmap, next))
                longest = next
            }
            throw AttachmentRules.tooLarge(null, maxBytes)
        } finally {
            bitmap.recycle()
        }
    }

    private fun undecodable(): ClayverException = ClayverException(
        ClayverErrorCode.UNSUPPORTED_ATTACHMENT_TYPE,
        "The image could not be decoded on this device.",
    )

    /** Recycles [old] when a transformation returned a new bitmap. */
    private fun replace(old: Bitmap, new: Bitmap): Bitmap {
        if (new !== old) old.recycle()
        return new
    }

    private fun scaleToFit(bitmap: Bitmap, maxDimension: Int): Bitmap {
        val (w, h) = ImageSizing.fitWithin(bitmap.width, bitmap.height, maxDimension)
        if (w == bitmap.width && h == bitmap.height) return bitmap
        return Bitmap.createScaledBitmap(bitmap, w, h, true)
    }

    private fun encode(bitmap: Bitmap, quality: Int): ByteArray {
        val out = ByteArrayOutputStream()
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)) {
            throw ClayverException(ClayverErrorCode.INTERNAL, "The image could not be encoded as JPEG.")
        }
        return out.toByteArray()
    }

    /** JPEG has no alpha channel: draw transparent images on white instead of black. */
    private fun flattenAlpha(bitmap: Bitmap): Bitmap {
        if (!bitmap.hasAlpha()) return bitmap
        val flat = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(flat)
        canvas.drawColor(Color.WHITE)
        canvas.drawBitmap(bitmap, 0f, 0f, Paint(Paint.FILTER_BITMAP_FLAG))
        return flat
    }

    /** The EXIF orientation, read with the platform ExifInterface (stream constructor needs API 24). */
    private fun exifOrientation(source: ByteArray): Int {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return ExifInterface.ORIENTATION_NORMAL
        return try {
            ExifInterface(ByteArrayInputStream(source))
                .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } catch (_: Exception) {
            ExifInterface.ORIENTATION_NORMAL
        }
    }

    private fun applyOrientation(bitmap: Bitmap, orientation: Int): Bitmap {
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.setRotate(-90f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
            else -> return bitmap
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }
}

/** Bytes and metadata exactly as they will be stored. */
internal class PreparedUpload(
    val bytes: ByteArray,
    val fileName: String,
    val contentType: String,
    val width: Int?,
    val height: Int?,
)

/**
 * Reads an attachment input and, unless it is already prepared, compresses it
 * to a JPEG within the upload limit. Reads on [Dispatchers.IO] and compresses on
 * [Dispatchers.Default]; the result's size and dimensions match its bytes.
 */
internal suspend fun ClayverAttachmentInput.prepareForUpload(): PreparedUpload {
    val declaredType = validateDeclared()
    if (isPrepared) {
        val bytes = withContext(Dispatchers.IO) { AttachmentRules.readBounded(openStream()) }
        AttachmentRules.validate(declaredType, fileName, bytes.size.toLong())
        return PreparedUpload(bytes, AttachmentRules.sanitizeFileName(fileName), declaredType, width, height)
    }
    val source = withContext(Dispatchers.IO) {
        AttachmentRules.readBounded(openStream(), AttachmentRules.MAX_SOURCE_IMAGE_BYTES)
    }
    if (source.isEmpty()) throw ClayverException.invalidArgument("The attachment is empty.")
    val image = withContext(Dispatchers.Default) { ImageCompressor.compress(source) }
    val name = AttachmentRules.jpegFileName(fileName)
    val type = AttachmentRules.validate(AttachmentRules.UPLOAD_CONTENT_TYPE, name, image.bytes.size.toLong())
    return PreparedUpload(image.bytes, name, type, image.width, image.height)
}
