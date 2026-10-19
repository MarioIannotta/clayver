/// Clayver: in-app customer support backed by your own Firebase project.
///
/// A thin wrapper over the native iOS (`ClayverSDK`) and Android
/// (`com.clayver.sdk.Clayver`) SDKs.
library;

export 'src/clayver.dart' show Clayver, ClayverUserProperties;
export 'src/exception.dart' show ClayverErrorCode, ClayverException;
export 'src/models.dart';
