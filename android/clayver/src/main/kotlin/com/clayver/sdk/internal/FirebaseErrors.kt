package com.clayver.sdk.internal

import com.clayver.sdk.ClayverErrorCode
import com.clayver.sdk.ClayverException
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.FirebaseTooManyRequestsException
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.DatabaseException
import com.google.firebase.functions.FirebaseFunctionsException
import com.google.firebase.storage.StorageException
import kotlinx.coroutines.CancellationException
import java.io.IOException

/** Maps any Firebase/platform failure to a [ClayverException]. */
internal fun Throwable.toClayverException(): ClayverException {
    val msg = message ?: javaClass.simpleName
    return when (this) {
        is ClayverException -> this
        is FirebaseFunctionsException -> ClayverException(ErrorCodes.fromCallableCode(code.name), msg, this)
        is StorageException -> {
            // An upload that failed because of a network problem reports ERROR_UNKNOWN with an IOException cause.
            val mapped = ErrorCodes.fromStorageErrorCode(errorCode)
            val code = if (mapped == ClayverErrorCode.INTERNAL && (cause is IOException || getIsRecoverableException())) {
                ClayverErrorCode.NETWORK
            } else {
                mapped
            }
            ClayverException(code, msg, this)
        }
        is DatabaseException -> ClayverException(ErrorCodes.fromDatabaseMessage(message), msg, this)
        is FirebaseNetworkException -> ClayverException(ClayverErrorCode.NETWORK, msg, this)
        is FirebaseTooManyRequestsException -> ClayverException(ClayverErrorCode.NETWORK, msg, this)
        is FirebaseAuthException -> ClayverException(ClayverErrorCode.NOT_AUTHENTICATED, msg, this)
        is IOException -> ClayverException(ClayverErrorCode.NETWORK, msg, this)
        is IllegalArgumentException -> ClayverException(ClayverErrorCode.INVALID_ARGUMENT, msg, this)
        else -> ClayverException(ClayverErrorCode.INTERNAL, msg, this)
    }
}

internal fun DatabaseError.toClayverException(): ClayverException =
    ClayverException(ErrorCodes.fromDatabaseErrorCode(code), message, toException())

/** Runs [block], letting coroutine cancellation through and mapping every other failure. */
internal suspend inline fun <T> clayverCall(crossinline block: suspend () -> T): T =
    try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Throwable) {
        throw e.toClayverException()
    }
