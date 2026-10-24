package com.iamwaqargulzar.automorphe.work

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.iamwaqargulzar.automorphe.R
import com.iamwaqargulzar.automorphe.data.FeedClient
import com.iamwaqargulzar.automorphe.data.Prefs
import com.iamwaqargulzar.automorphe.data.Status
import com.iamwaqargulzar.automorphe.data.entries
import com.iamwaqargulzar.automorphe.ui.MainActivity
import java.util.concurrent.TimeUnit

/** Checks the feed in the background and posts one notification per new build. */
class UpdateWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val feed = FeedClient.load(applicationContext).getOrElse { return Result.retry() }
        val prefs = Prefs(applicationContext)
        val updates = entries(feed, applicationContext.packageManager, prefs).filter { it.status == Status.UpdateAvailable }
        val fresh = updates.filter { it.app.build !in prefs.notifiedBuilds }
        if (fresh.isNotEmpty()) {
            notify(applicationContext, updates.map { it.app.name })
            prefs.notifiedBuilds = prefs.notifiedBuilds + fresh.map { it.app.build }
        }
        return Result.success()
    }

    companion object {
        private const val WORK = "update-check"
        const val CHANNEL = "updates"

        fun schedule(context: Context) {
            val prefs = Prefs(context)
            val wm = WorkManager.getInstance(context)
            if (!prefs.autoCheck) {
                wm.cancelUniqueWork(WORK)
                return
            }
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(if (prefs.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<UpdateWorker>(6, TimeUnit.HOURS)
                .setConstraints(constraints)
                .build()
            wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, request)
        }

        fun createChannel(context: Context) {
            val channel = NotificationChannel(CHANNEL, context.getString(R.string.channel_updates), NotificationManager.IMPORTANCE_DEFAULT)
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }

        private fun notify(context: Context, names: List<String>) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) return
            val open = PendingIntent.getActivity(
                context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
            )
            val title = if (names.size == 1) "${names[0]} update ready" else "${names.size} updates ready"
            val notification = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_update)
                .setContentTitle(title)
                .setContentText(names.joinToString(", "))
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
            NotificationManagerCompat.from(context).notify(1, notification)
        }
    }
}
