package com.clayver.sdk

/**
 * Stable error codes shared by every Clayver SDK (see docs/sdk-api.md).
 * [wireName] is the lowerCamelCase string used by the Flutter plugin.
 */
public enum class ClayverErrorCode(public val wireName: String) {
    NOT_CONFIGURED("notConfigured"),
    NOT_AUTHENTICATED("notAuthenticated"),
    PERMISSION_DENIED("permissionDenied"),
    INVALID_ARGUMENT("invalidArgument"),
    NETWORK("network"),
    ATTACHMENT_TOO_LARGE("attachmentTooLarge"),
    UNSUPPORTED_ATTACHMENT_TYPE("unsupportedAttachmentType"),
    CANCELLED("cancelled"),
    INTERNAL("internal");

    public companion object {
        public fun fromWireName(name: String): ClayverErrorCode? = entries.firstOrNull { it.wireName == name }
    }
}

/**
 * The single exception type thrown by every Clayver API.
 *
 * Coroutine cancellation is never wrapped: cancelling the calling coroutine
 * propagates the original [kotlinx.coroutines.CancellationException].
 * [ClayverErrorCode.CANCELLED] is only used when Firebase itself reports that an
 * operation was cancelled (for example an upload cancelled by the system).
 */
public class ClayverException(
    public val code: ClayverErrorCode,
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause) {
    override fun toString(): String = "ClayverException(${code.wireName}): $message"

    internal companion object {
        fun notConfigured(): ClayverException = ClayverException(
            ClayverErrorCode.NOT_CONFIGURED,
            "Clayver is not configured. Call Clayver.configure(context, options) first.",
        )

        fun notAuthenticated(message: String = "No Firebase user is signed in."): ClayverException =
            ClayverException(ClayverErrorCode.NOT_AUTHENTICATED, message)

        fun invalidArgument(message: String): ClayverException =
            ClayverException(ClayverErrorCode.INVALID_ARGUMENT, message)

        fun notAgent(projectId: String): ClayverException = ClayverException(
            ClayverErrorCode.PERMISSION_DENIED,
            "The signed-in user has no agent or admin role in workspace \"$projectId\".",
        )
    }
}
