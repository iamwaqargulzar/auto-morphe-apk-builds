package com.iamwaqargulzar.automorphe.data

import android.content.Context
import com.iamwaqargulzar.automorphe.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** The portal's /api/v1/apps.json. Field names match tool/catalog.ts in the main repo. */
@Serializable
data class Feed(
    val schema: Int,
    val generatedAt: String,
    val site: String,
    val certSha256: String,
    val updater: UpdaterRelease? = null,
    val apps: List<FeedApp>,
)

@Serializable
data class UpdaterRelease(
    val versionName: String,
    val versionCode: Int,
    val url: String,
    val size: Long,
    val sha256: String,
)

@Serializable
data class FeedApp(
    val id: String,
    val name: String,
    val about: String,
    val icon: String? = null,
    @SerialName("package") val packageName: String,
    val originalPackage: String,
    val versionName: String,
    val build: String,
    val releasedAt: String,
    val releaseUrl: String,
    val microg: Boolean = false,
    val patchesRepo: String,
    val patchesVersion: String,
    val patchCount: Int,
    val files: Map<String, FeedFile>,
    /** Optional extra build, e.g. an old Reddit that can still log in. */
    val helper: FeedHelper? = null,
)

@Serializable
data class FeedHelper(
    val name: String,
    val about: String,
    val versionName: String,
    val build: String,
    val files: Map<String, FeedFile>,
)

@Serializable
data class FeedFile(
    val url: String,
    val size: Long,
    val sha256: String? = null,
)

object FeedClient {
    private val json = Json { ignoreUnknownKeys = true }

    private fun cacheFile(context: Context) = File(context.filesDir, "feed.json")

    /** Downloads the feed and caches it; falls back to the cached copy when offline. */
    suspend fun load(context: Context): Result<Feed> = withContext(Dispatchers.IO) {
        runCatching {
            val conn = URL(BuildConfig.FEED_URL).openConnection() as HttpURLConnection
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.setRequestProperty("User-Agent", "AutoMorphe/${BuildConfig.VERSION_NAME}")
            conn.setRequestProperty("Cache-Control", "no-cache")
            try {
                if (conn.responseCode != 200) error("Feed returned HTTP ${conn.responseCode}")
                val text = conn.inputStream.bufferedReader().use { it.readText() }
                val feed = json.decodeFromString<Feed>(text)
                cacheFile(context).writeText(text)
                feed
            } finally {
                conn.disconnect()
            }
        }.recoverCatching { err ->
            val cached = cacheFile(context)
            if (!cached.exists()) throw err
            json.decodeFromString<Feed>(cached.readText())
        }
    }

    fun cached(context: Context): Feed? = runCatching {
        json.decodeFromString<Feed>(cacheFile(context).readText())
    }.getOrNull()
}
