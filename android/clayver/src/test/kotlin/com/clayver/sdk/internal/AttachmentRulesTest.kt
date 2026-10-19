package com.clayver.sdk.internal

import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream

class AttachmentRulesTest {
    @Test fun normalizesContentTypes() {
        assertEquals("image/jpeg", AttachmentRules.normalizeContentType("IMAGE/JPG", null))
        assertEquals("image/png", AttachmentRules.normalizeContentType("image/png; foo=bar", null))
        assertEquals("image/webp", AttachmentRules.normalizeContentType("application/octet-stream", "a.WEBP"))
        assertEquals("image/heic", AttachmentRules.normalizeContentType("image/heif", null))
        assertEquals("image/png", AttachmentRules.normalizeContentType(null, "shot.png"))
        assertEquals(null, AttachmentRules.normalizeContentType(null, "noext"))
    }

    @Test fun validatesTypeAndSize() {
        assertEquals("image/png", AttachmentRules.validate("image/png", "a.png", 10))
        assertEquals(300L * 1024, AttachmentRules.MAX_SIZE_BYTES)
        assertEquals(
            setOf("image/jpeg", "image/png", "image/gif", "image/webp", "image/heic"),
            AttachmentRules.ALLOWED_CONTENT_TYPES,
        )
        assertEquals("image/jpeg", AttachmentRules.validate(null, "a.jpg", AttachmentRules.MAX_SIZE_BYTES))
        for (type in listOf("application/pdf", "text/plain", "application/zip")) {
            val e = assertThrows(ClayverException::class.java) { AttachmentRules.validate(type, "a", 10) }
            assertEquals(ClayverErrorCode.UNSUPPORTED_ATTACHMENT_TYPE, e.code)
        }
        // A raw image the SDK will still compress may be larger than the upload limit.
        assertEquals("image/png", AttachmentRules.validate("image/png", "a.png", 5L * 1024 * 1024, AttachmentRules.MAX_SOURCE_IMAGE_BYTES))
        val tooBigSource = assertThrows(ClayverException::class.java) {
            AttachmentRules.validate("image/png", "a.png", AttachmentRules.MAX_SOURCE_IMAGE_BYTES + 1, AttachmentRules.MAX_SOURCE_IMAGE_BYTES)
        }
        assertEquals(ClayverErrorCode.ATTACHMENT_TOO_LARGE, tooBigSource.code)
        val tooBig = assertThrows(ClayverException::class.java) { AttachmentRules.validate("image/png", "a.png", AttachmentRules.MAX_SIZE_BYTES + 1) }
        assertEquals(ClayverErrorCode.ATTACHMENT_TOO_LARGE, tooBig.code)
        val badType = assertThrows(ClayverException::class.java) { AttachmentRules.validate("video/mp4", "a.mp4", 10) }
        assertEquals(ClayverErrorCode.UNSUPPORTED_ATTACHMENT_TYPE, badType.code)
        val empty = assertThrows(ClayverException::class.java) { AttachmentRules.validate("image/png", "a.png", 0) }
        assertEquals(ClayverErrorCode.INVALID_ARGUMENT, empty.code)
    }

    @Test fun jpegFileNames() {
        assertEquals("IMG_1.jpg", AttachmentRules.jpegFileName("IMG_1.HEIC"))
        assertEquals("shot.jpg", AttachmentRules.jpegFileName("shot.png"))
        assertEquals("photo.jpg", AttachmentRules.jpegFileName("photo"))
        assertEquals("file.jpg", AttachmentRules.jpegFileName(null))
        val long = AttachmentRules.jpegFileName("x".repeat(300) + ".png")
        assertTrue(long.length <= AttachmentRules.MAX_FILE_NAME_LENGTH)
        assertTrue(long.endsWith(".jpg"))
    }

    @Test fun imageSizing() {
        assertEquals(1, ImageSizing.inSampleSize(1600, 1200))
        assertEquals(1, ImageSizing.inSampleSize(3000, 2000))
        assertEquals(2, ImageSizing.inSampleSize(4032, 3024))
        assertEquals(4, ImageSizing.inSampleSize(2000, 8000))
        assertEquals(1600 to 1200, ImageSizing.fitWithin(4000, 3000))
        assertEquals(400 to 1600, ImageSizing.fitWithin(1000, 4000))
        assertEquals(800 to 600, ImageSizing.fitWithin(800, 600))
        assertEquals(1200, ImageSizing.nextDimension(1600))
        assertEquals(null, ImageSizing.nextDimension(200))
        assertEquals(listOf(85, 75, 65, 55, 45), ImageSizing.JPEG_QUALITIES)
    }

    @Test fun sanitizesFileNames() {
        assertEquals("passwd", AttachmentRules.sanitizeFileName("../../etc/passwd"))
        assertEquals("file", AttachmentRules.sanitizeFileName(""))
        assertEquals("file", AttachmentRules.sanitizeFileName(null))
        assertEquals("a b.pdf", AttachmentRules.sanitizeFileName("C:\\docs\\a b.pdf"))
        assertEquals("ab.png", AttachmentRules.sanitizeFileName("a\u0000#b.png"))
        val long = AttachmentRules.sanitizeFileName("x".repeat(300) + ".jpeg")
        assertEquals(200, long.length)
        assertTrue(long.endsWith(".jpeg"))
    }

    @Test fun readBoundedEnforcesLimit() {
        assertEquals(5, AttachmentRules.readBounded(ByteArrayInputStream(ByteArray(5)), 5).size)
        val e = assertThrows(ClayverException::class.java) { AttachmentRules.readBounded(ByteArrayInputStream(ByteArray(6)), 5) }
        assertEquals(ClayverErrorCode.ATTACHMENT_TOO_LARGE, e.code)
    }

    @Test fun messageText() {
        assertEquals(null, MessageRules.normalizeText("   "))
        assertEquals("hi", MessageRules.normalizeText("  hi \n"))
        assertEquals(4000, MessageRules.normalizeText("y".repeat(4000))!!.length)
        assertThrows(ClayverException::class.java) { MessageRules.normalizeText("y".repeat(4001)) }
    }

    @Test fun storagePathMatchesSchema() {
        assertEquals(
            "clayver/projects/default/customers/v_abc/conversations/-Nc/-Na/photo.jpg",
            Paths("default").attachment("v_abc", "-Nc", "-Na", "photo.jpg"),
        )
        assertEquals("clayver/projects/default/devices/customers/cid/dev12345", Paths("default").customerDevice("cid", "dev12345"))
        assertEquals("clayver/projects/default/inbox/cid/unreadTotal", Paths("default").unreadTotal("cid"))
    }
}
