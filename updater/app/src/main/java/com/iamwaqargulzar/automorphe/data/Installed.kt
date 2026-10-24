package com.iamwaqargulzar.automorphe.data

import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import java.security.MessageDigest

data class InstalledApp(
    val versionName: String,
    val certSha256: Set<String>,
)

/** Version and signing certificates of an installed package, or null if it isn't installed. */
fun PackageManager.installedApp(packageName: String): InstalledApp? {
    val info: PackageInfo = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        } else {
            @Suppress("DEPRECATION")
            getPackageInfo(packageName, PackageManager.GET_SIGNATURES)
        }
    } catch (_: PackageManager.NameNotFoundException) {
        return null
    }
    val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        val signing = info.signingInfo
        when {
            signing == null -> emptyArray()
            signing.hasMultipleSigners() -> signing.apkContentsSigners
            else -> signing.signingCertificateHistory
        }
    } else {
        @Suppress("DEPRECATION")
        info.signatures ?: emptyArray()
    }
    val digest = MessageDigest.getInstance("SHA-256")
    val certs = signatures.map { sig -> digest.digest(sig.toByteArray()).joinToString("") { "%02x".format(it) } }.toSet()
    return InstalledApp(info.versionName ?: "", certs)
}

/** The CPU type to download for: the first one this phone supports that we build. */
fun preferredAbi(available: Set<String>, override: String?): String? {
    if (override != null && override in available) return override
    return Build.SUPPORTED_ABIS.firstOrNull { it in available }
}
