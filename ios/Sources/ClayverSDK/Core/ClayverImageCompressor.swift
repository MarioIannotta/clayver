import Foundation
import ImageIO
#if canImport(UIKit)
import UIKit
#endif

/// Re-encodes images as JPEG of at most `ClayverAttachmentRules.maxSize` bytes before upload.
///
/// The image is downscaled so its longest side is at most `maxDimension` pixels, then encoded
/// with decreasing JPEG quality; if it is still too large, the dimensions keep shrinking until
/// it fits. Redrawing also applies the EXIF orientation and drops photo metadata (location).
public enum ClayverImageCompressor {
    /// Longest side, in pixels, of a compressed image.
    public static let maxDimension: CGFloat = 1600
    static let qualities: [CGFloat] = [0.8, 0.7, 0.6, 0.5, 0.4]
    /// Smallest longest side tried before giving up.
    static let minDimension: CGFloat = 200

    /// Pixel size of encoded image data, read from its header without decoding it.
    static func pixelSize(of data: Data) -> CGSize? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue,
              let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue
        else { return nil }
        let orientation = (properties[kCGImagePropertyOrientation] as? NSNumber)?.intValue ?? 1
        // Orientations 5...8 rotate the image by 90 degrees.
        return orientation >= 5 ? CGSize(width: height, height: width) : CGSize(width: width, height: height)
    }

    /// Whether `input` is already a JPEG within the size and dimension limits (no work needed).
    static func isCompressed(_ input: ClayverAttachmentInput) -> Bool {
        guard input.contentType.lowercased() == "image/jpeg",
              !input.data.isEmpty, input.data.count <= ClayverAttachmentRules.maxSize,
              let size = pixelSize(of: input.data),
              max(size.width, size.height) <= maxDimension
        else { return false }
        return true
    }

    /// `baseName.jpg`, keeping the base of `fileName`.
    static func jpegFileName(_ fileName: String) -> String {
        let base = (fileName as NSString).deletingPathExtension
        return (base.isEmpty ? "photo" : base) + ".jpg"
    }

    #if canImport(UIKit)
    /// Compresses image data into a JPEG attachment of at most `ClayverAttachmentRules.maxSize`.
    /// `width`/`height` describe the compressed image.
    public static func compress(_ data: Data, fileName: String) throws -> ClayverAttachmentInput {
        guard let image = UIImage(data: data) else {
            throw ClayverError.invalidArgument("The image could not be read.")
        }
        guard let (jpeg, size) = jpegFitting(image) else {
            throw ClayverError.attachmentTooLarge(size: data.count, limit: ClayverAttachmentRules.maxSize)
        }
        return ClayverAttachmentInput(
            data: jpeg,
            fileName: jpegFileName(fileName),
            contentType: "image/jpeg",
            width: Int(size.width),
            height: Int(size.height)
        )
    }

    /// Images are compressed (unless already a JPEG within the limits, then only their file
    /// name and dimensions are normalized); other inputs are returned unchanged.
    public static func compress(_ input: ClayverAttachmentInput) throws -> ClayverAttachmentInput {
        guard input.isImage || pixelSize(of: input.data) != nil else { return input }
        if isCompressed(input) {
            let size = pixelSize(of: input.data)
            return ClayverAttachmentInput(
                data: input.data,
                fileName: jpegFileName(input.fileName),
                contentType: "image/jpeg",
                width: size.map { Int($0.width) } ?? input.width,
                height: size.map { Int($0.height) } ?? input.height
            )
        }
        return try compress(input.data, fileName: input.fileName)
    }

    private static func jpegFitting(_ image: UIImage) -> (Data, CGSize)? {
        let pixelSize = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        let longest = max(pixelSize.width, pixelSize.height)
        guard longest > 0 else { return nil }
        var dimension = min(longest, maxDimension)
        var lastAttempt = false
        repeat {
            lastAttempt = dimension <= minDimension
            let scaled = render(image, pixelSize: pixelSize, maxDimension: dimension)
            let scaledSize = CGSize(width: scaled.size.width * scaled.scale, height: scaled.size.height * scaled.scale)
            for quality in qualities {
                if let data = scaled.jpegData(compressionQuality: quality), data.count <= ClayverAttachmentRules.maxSize {
                    return (data, scaledSize)
                }
            }
            dimension = max(minDimension, (dimension * 0.75).rounded(.down))
        } while !lastAttempt
        return nil
    }

    /// Draws the image (orientation applied) at scale 1 with its longest side at most `maxDimension`.
    private static func render(_ image: UIImage, pixelSize: CGSize, maxDimension: CGFloat) -> UIImage {
        let longest = max(pixelSize.width, pixelSize.height)
        let ratio = min(1, maxDimension / longest)
        let target = CGSize(
            width: max(1, (pixelSize.width * ratio).rounded()),
            height: max(1, (pixelSize.height * ratio).rounded())
        )
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: target, format: format).image { context in
            // JPEG has no alpha: fill transparent areas (PNG/GIF) with white instead of black.
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: target))
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }
    #endif
}
