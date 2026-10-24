package com.iamwaqargulzar.automorphe.data

import android.content.Context
import androidx.core.content.edit

/** Small settings store, plus which build we last installed for each package. */
class Prefs(context: Context) {
    private val prefs = context.getSharedPreferences("automorphe", Context.MODE_PRIVATE)

    fun installedBuild(packageName: String): String? = prefs.getString("build:$packageName", null)

    fun setInstalledBuild(packageName: String, build: String) = prefs.edit { putString("build:$packageName", build) }

    var autoCheck: Boolean
        get() = prefs.getBoolean("autoCheck", true)
        set(value) = prefs.edit { putBoolean("autoCheck", value) }

    var wifiOnly: Boolean
        get() = prefs.getBoolean("wifiOnly", false)
        set(value) = prefs.edit { putBoolean("wifiOnly", value) }

    /** null = automatic (follow the phone's CPU type). */
    var abiOverride: String?
        get() = prefs.getString("abiOverride", null)
        set(value) = prefs.edit { if (value == null) remove("abiOverride") else putString("abiOverride", value) }

    /** Builds already announced in a notification, so each update notifies once. */
    var notifiedBuilds: Set<String>
        get() = prefs.getStringSet("notified", emptySet()) ?: emptySet()
        set(value) = prefs.edit { putStringSet("notified", value) }
}
