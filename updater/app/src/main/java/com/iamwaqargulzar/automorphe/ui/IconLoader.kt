package com.iamwaqargulzar.automorphe.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.net.URL

/** App icons from the portal, cached in memory and on disk. */
object IconLoader {
    private val memory = LruCache<String, Bitmap>(32)

    suspend fun load(context: Context, url: String): Bitmap? = memory.get(url) ?: withContext(Dispatchers.IO) {
        runCatching {
            val file = File(context.cacheDir, "icons/${url.hashCode()}.png").apply { parentFile?.mkdirs() }
            if (!file.exists()) URL(url).openStream().use { input -> file.outputStream().use { input.copyTo(it) } }
            BitmapFactory.decodeFile(file.path)?.also { memory.put(url, it) }
        }.getOrNull()
    }
}

@Composable
fun rememberIcon(url: String?): ImageBitmap? {
    val context = LocalContext.current
    var bitmap by remember(url) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(url) {
        if (url != null) bitmap = IconLoader.load(context, url)?.asImageBitmap()
    }
    return bitmap
}
