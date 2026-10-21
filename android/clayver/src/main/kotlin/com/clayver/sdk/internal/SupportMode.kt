package com.clayver.sdk.internal

import android.content.SharedPreferences

/**
 * Which side of the built-in support UI [com.clayver.sdk.Clayver.openChat]
 * shows to a user who is also a support agent: their own conversations
 * ([CUSTOMER]) or the team's inbox ([AGENT]).
 */
internal enum class SupportMode {
    CUSTOMER,
    AGENT,
}

/**
 * Remembers the [SupportMode] per workspace and signed-in user across launches
 * (the SDK's SharedPreferences). Users without a stored choice, or with no uid
 * yet, are customers.
 */
internal object SupportModeStore {
    fun mode(prefs: SharedPreferences, uid: String?, projectId: String?): SupportMode {
        uid ?: return SupportMode.CUSTOMER
        return parse(prefs.getString(key(uid, projectId), null))
    }

    fun set(prefs: SharedPreferences, mode: SupportMode, uid: String?, projectId: String?) {
        uid ?: return
        prefs.edit().putString(key(uid, projectId), mode.name).apply()
    }

    fun key(uid: String, projectId: String?): String = "supportMode.${projectId ?: "default"}.$uid"

    fun parse(value: String?): SupportMode = SupportMode.entries.firstOrNull { it.name == value } ?: SupportMode.CUSTOMER
}
