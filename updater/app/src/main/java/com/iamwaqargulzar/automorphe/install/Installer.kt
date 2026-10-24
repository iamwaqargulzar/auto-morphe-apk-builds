package com.iamwaqargulzar.automorphe.install

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import com.iamwaqargulzar.automorphe.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

sealed interface InstallResult {
    data class Success(val packageName: String) : InstallResult
    data class Failure(val packageName: String, val message: String) : InstallResult
}

object Installer {
    private const val ACTION = "com.iamwaqargulzar.automorphe.INSTALL_STATUS"
    private val results = Channel<InstallResult>(Channel.BUFFERED)
    val events = results.receiveAsFlow()

    /** Downloads [url] into the cache, reporting progress 0..1, and checks the SHA-256 when known. */
    suspend fun download(context: Context, url: String, sha256: String?, onProgress: (Float) -> Unit): File =
        withContext(Dispatchers.IO) {
            val dir = File(context.cacheDir, "apks").apply { mkdirs() }
            val target = File(dir, url.substringAfterLast('/'))
            val part = File(dir, "${target.name}.part")
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = true
            conn.connectTimeout = 20_000
            conn.readTimeout = 60_000
            conn.setRequestProperty("User-Agent", "AutoMorphe/${BuildConfig.VERSION_NAME}")
            try {
                if (conn.responseCode != 200) error("Download failed (HTTP ${conn.responseCode})")
                val total = conn.contentLengthLong.takeIf { it > 0 }
                val digest = MessageDigest.getInstance("SHA-256")
                conn.inputStream.use { input ->
                    part.outputStream().use { out ->
                        val buf = ByteArray(256 * 1024)
                        var done = 0L
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            digest.update(buf, 0, n)
                            done += n
                            if (total != null) onProgress(done.toFloat() / total)
                        }
                    }
                }
                val actual = digest.digest().joinToString("") { "%02x".format(it) }
                if (sha256 != null && !actual.equals(sha256, ignoreCase = true)) {
                    part.delete()
                    error("Checksum mismatch: the download was corrupted or tampered with")
                }
                if (!part.renameTo(target)) error("Could not save the download")
                target
            } finally {
                conn.disconnect()
            }
        }

    /** Hands [apk] to Android's package installer; the outcome arrives on [events]. */
    suspend fun install(context: Context, apk: File, packageName: String) = withContext(Dispatchers.IO) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(packageName)
            setSize(apk.length())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // Lets Android 12+ update apps we installed without asking again.
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            apk.inputStream().use { input ->
                session.openWrite("base.apk", 0, apk.length()).use { out ->
                    input.copyTo(out, 256 * 1024)
                    session.fsync(out)
                }
            }
            val intent = Intent(context, InstallReceiver::class.java).setAction(ACTION).putExtra("pkg", packageName)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
            val pending = PendingIntent.getBroadcast(context, sessionId, intent, flags)
            session.commit(pending.intentSender)
        }
    }

    internal fun report(result: InstallResult) {
        results.trySend(result)
    }
}

class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pkg = intent.getStringExtra("pkg") ?: return
        when (val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // Android wants the user to confirm: show its dialog.
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> Installer.report(InstallResult.Success(pkg))
            else -> {
                val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                Installer.report(InstallResult.Failure(pkg, friendlyError(status, message)))
            }
        }
    }

    private fun friendlyError(status: Int, message: String?): String = when (status) {
        PackageInstaller.STATUS_FAILURE_ABORTED -> "Installation cancelled"
        PackageInstaller.STATUS_FAILURE_CONFLICT ->
            "Conflicts with an installed app signed by someone else. Uninstall it first."
        PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "Not compatible with this phone"
        PackageInstaller.STATUS_FAILURE_STORAGE -> "Not enough storage"
        else -> message ?: "Installation failed"
    }
}
