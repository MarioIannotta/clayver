package com.clayver.sdk.internal

import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.Query
import com.google.firebase.database.ValueEventListener
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.conflate

/**
 * Emits every value of [this] query. The listener is removed when the
 * collector is cancelled; a listener cancellation (e.g. permission denied)
 * fails the flow with a ClayverException.
 */
internal fun Query.valueFlow(): Flow<DataSnapshot> = callbackFlow {
    val listener = object : ValueEventListener {
        override fun onDataChange(snapshot: DataSnapshot) {
            trySend(snapshot)
        }

        override fun onCancelled(error: DatabaseError) {
            close(error.toClayverException())
        }
    }
    addValueEventListener(listener)
    awaitClose { removeEventListener(listener) }
}.conflate()
