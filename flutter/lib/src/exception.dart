import 'package:flutter/services.dart';

/// Stable Clayver error codes, identical on iOS, Android and Flutter.
abstract final class ClayverErrorCode {
  /// `Clayver.configure` has not completed.
  static const String notConfigured = 'notConfigured';

  /// No Firebase user could be signed in, or the identity was rejected.
  static const String notAuthenticated = 'notAuthenticated';

  /// Security rules or a Cloud Function denied the operation.
  static const String permissionDenied = 'permissionDenied';

  /// An argument is invalid (bad property key/value, empty message, ...).
  static const String invalidArgument = 'invalidArgument';

  /// The device is offline or the backend could not be reached.
  static const String network = 'network';

  /// The attachment is still larger than 300 KB after the native SDK
  /// compressed it to JPEG.
  static const String attachmentTooLarge = 'attachmentTooLarge';

  /// The attachment is not an image (only photos can be attached).
  static const String unsupportedAttachmentType = 'unsupportedAttachmentType';

  /// The operation was cancelled (for example the engine was detached).
  static const String cancelled = 'cancelled';

  /// Any other failure.
  static const String internal = 'internal';

  /// Every known code.
  static const Set<String> values = {
    notConfigured,
    notAuthenticated,
    permissionDenied,
    invalidArgument,
    network,
    attachmentTooLarge,
    unsupportedAttachmentType,
    cancelled,
    internal,
  };
}

/// The single error type thrown by every Clayver API and emitted by every
/// Clayver stream.
class ClayverException implements Exception {
  /// Creates an exception. [code] is one of [ClayverErrorCode].
  const ClayverException(this.code, [this.message, this.details]);

  /// Maps a [PlatformException] coming from the native SDK. Unknown codes
  /// (for example Pigeon's `channel-error` when the plugin is not registered)
  /// become [ClayverErrorCode.internal]; the original code is kept in
  /// [details] as `platformCode`.
  factory ClayverException.fromPlatformException(PlatformException e) {
    if (ClayverErrorCode.values.contains(e.code)) {
      return ClayverException(e.code, e.message, e.details);
    }
    return ClayverException(
      ClayverErrorCode.internal,
      e.message ?? e.code,
      <String, Object?>{'platformCode': e.code, 'details': e.details},
    );
  }

  /// One of [ClayverErrorCode].
  final String code;

  /// Human-readable description (not localized, not stable).
  final String? message;

  /// Extra platform-specific information, if any.
  final Object? details;

  @override
  String toString() =>
      'ClayverException($code${message == null ? '' : ', $message'})';
}

/// Converts any error thrown by the bridge into a [ClayverException].
ClayverException mapClayverError(Object error) {
  if (error is ClayverException) return error;
  if (error is PlatformException) {
    return ClayverException.fromPlatformException(error);
  }
  if (error is MissingPluginException) {
    return ClayverException(
      ClayverErrorCode.internal,
      'The Clayver plugin is not registered on this platform: ${error.message}',
    );
  }
  return ClayverException(ClayverErrorCode.internal, error.toString(), error);
}
