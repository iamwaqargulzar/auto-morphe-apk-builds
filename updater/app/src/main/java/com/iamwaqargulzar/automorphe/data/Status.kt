package com.iamwaqargulzar.automorphe.data

import android.content.pm.PackageManager

enum class Status {
    /** Not on this phone. */
    NotInstalled,

    /** Installed from us and current. */
    UpToDate,

    /** Installed from us, newer app version or newer patches available. */
    UpdateAvailable,

    /** Installed but signed by someone else (e.g. the Play Store version); must be uninstalled first. */
    OtherSource,

    /** No build for this phone's CPU type. */
    Unsupported,
}

data class AppEntry(
    val app: FeedApp,
    val status: Status,
    val installedVersion: String?,
    val abi: String?,
) {
    val file: FeedFile? get() = abi?.let { app.files[it] }
}

/**
 * Builds the list shown in the app. Versions are compared by name plus our
 * build id: some patches pin versionCode to the maximum, so codes can't be
 * trusted, and a patch-only update keeps the same app version.
 */
fun entries(feed: Feed, pm: PackageManager, prefs: Prefs): List<AppEntry> = feed.apps.map { app ->
    val abi = preferredAbi(app.files.keys, prefs.abiOverride)
    val installed = pm.installedApp(app.packageName)
    val status = when {
        abi == null -> Status.Unsupported
        installed == null -> Status.NotInstalled
        feed.certSha256.lowercase() !in installed.certSha256 -> Status.OtherSource
        installed.versionName != app.versionName -> Status.UpdateAvailable
        else -> {
            val known = prefs.installedBuild(app.packageName)
            if (known == null) {
                // Installed from the website: same version, assume the current build.
                prefs.setInstalledBuild(app.packageName, app.build)
                Status.UpToDate
            } else if (known != app.build) {
                Status.UpdateAvailable
            } else {
                Status.UpToDate
            }
        }
    }
    AppEntry(app, status, installed?.versionName, abi)
}
