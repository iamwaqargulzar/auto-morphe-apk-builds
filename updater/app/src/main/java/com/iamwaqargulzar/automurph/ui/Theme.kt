package com.iamwaqargulzar.automurph.ui

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

// Brand gradient, shared with the website.
val BrandStart = Color(0xFF14B8A6)
val BrandMid = Color(0xFF6366F1)
val BrandEnd = Color(0xFFA855F7)

private val Light = lightColorScheme(
    primary = Color(0xFF0F766E),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFCCFBF1),
    onPrimaryContainer = Color(0xFF042F2E),
    secondary = Color(0xFF4F46E5),
    tertiary = Color(0xFF9333EA),
    background = Color(0xFFF7F7FA),
    surface = Color(0xFFFFFFFF),
    surfaceContainer = Color(0xFFF0F1F5),
)

private val Dark = darkColorScheme(
    primary = Color(0xFF5EEAD4),
    onPrimary = Color(0xFF042F2E),
    primaryContainer = Color(0xFF134E4A),
    onPrimaryContainer = Color(0xFFCCFBF1),
    secondary = Color(0xFFA5B4FC),
    tertiary = Color(0xFFD8B4FE),
    background = Color(0xFF0B0B10),
    surface = Color(0xFF14141B),
    surfaceContainer = Color(0xFF1B1B24),
)

@Composable
fun AutoMurphTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val context = LocalContext.current
    val scheme = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        dark -> Dark
        else -> Light
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
