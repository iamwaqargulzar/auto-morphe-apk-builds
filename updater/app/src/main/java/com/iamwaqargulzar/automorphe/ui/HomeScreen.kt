package com.iamwaqargulzar.automurph.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.SystemUpdate
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.iamwaqargulzar.automurph.data.AppEntry
import com.iamwaqargulzar.automurph.data.Status
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

private enum class Filter(val label: String) { All("All apps"), Updates("Updates"), Installed("Installed") }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(vm: MainViewModel) {
    val state by vm.state.collectAsState()
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var filter by rememberSaveable { mutableStateOf(Filter.All) }
    var showSettings by remember { mutableStateOf(false) }

    LaunchedEffect(state.message) {
        state.message?.let {
            snackbar.showSnackbar(it)
            vm.consumeMessage()
        }
    }

    val canInstall = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()
    val shown = state.entries.filter {
        when (filter) {
            Filter.All -> true
            Filter.Updates -> it.status == Status.UpdateAvailable
            Filter.Installed -> it.status == Status.UpToDate || it.status == Status.UpdateAvailable
        }
    }

    Scaffold(snackbarHost = { SnackbarHost(snackbar) }, containerColor = MaterialTheme.colorScheme.background) { padding ->
        PullToRefreshBox(
            isRefreshing = state.loading && state.feed != null,
            onRefresh = vm::refresh,
            modifier = Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding()),
        ) {
            LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 32.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    Hero(
                        apps = state.entries.size,
                        installed = state.installed,
                        updates = state.updates,
                        onUpdateAll = vm::updateAll,
                        onSettings = { showSettings = true },
                    )
                }
                if (!canInstall) {
                    item {
                        Notice(
                            icon = Icons.Rounded.Security,
                            title = "Allow installs",
                            text = "To install and update apps, allow Auto Murph to install unknown apps.",
                            action = "Open settings",
                        ) {
                            context.startActivity(
                                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")),
                            )
                        }
                    }
                }
                if (state.selfUpdate) {
                    item {
                        val v = state.feed?.updater?.versionName.orEmpty()
                        Notice(
                            icon = Icons.Rounded.SystemUpdate,
                            title = "Auto Murph $v is available",
                            text = "Update the updater itself for the latest fixes.",
                            action = if (state.selfTask == null) "Update" else null,
                            progress = state.selfTask,
                            onAction = vm::installSelfUpdate,
                        )
                    }
                }
                if (state.error != null && state.feed == null) {
                    item {
                        Notice(Icons.Rounded.ErrorOutline, "Can't load apps", state.error.orEmpty(), "Try again", onAction = vm::refresh)
                    }
                }
                if (state.entries.isNotEmpty()) {
                    item {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(Filter.entries) { f ->
                                val count = when (f) {
                                    Filter.All -> state.entries.size
                                    Filter.Updates -> state.updates
                                    Filter.Installed -> state.installed
                                }
                                FilterChip(selected = filter == f, onClick = { filter = f }, label = { Text("${f.label} · $count") })
                            }
                        }
                    }
                }
                items(shown, key = { it.app.id }) { entry ->
                    AppCard(
                        entry = entry,
                        task = state.tasks[entry.app.packageName],
                        canInstall = canInstall,
                        vm = vm,
                        modifier = Modifier.animateItem(),
                    )
                }
                if (shown.isEmpty() && state.entries.isNotEmpty()) {
                    item {
                        Text(
                            if (filter == Filter.Updates) "Everything is up to date." else "Nothing here yet.",
                            modifier = Modifier.fillMaxWidth().padding(32.dp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }

    if (showSettings) SettingsSheet(vm) { showSettings = false }
}

@Composable
private fun Hero(apps: Int, installed: Int, updates: Int, onUpdateAll: () -> Unit, onSettings: () -> Unit) {
    // Slowly drifting gradient behind the header.
    val shift by rememberInfiniteTransition(label = "hero").animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(9000, easing = LinearEasing), RepeatMode.Reverse),
        label = "shift",
    )
    val brush = Brush.linearGradient(
        colors = listOf(BrandStart, BrandMid, BrandEnd),
        start = Offset(0f, 600f * shift),
        end = Offset(1200f, 600f * (1 - shift)),
    )
    Box(
        Modifier
            .fillMaxWidth()
            .padding(top = 8.dp)
            .statusBarsPadding()
            .clip(RoundedCornerShape(32.dp))
            .background(brush)
            .padding(22.dp),
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Auto Murph", color = Color.White, fontSize = 30.sp, fontWeight = FontWeight.Black)
                    Text("Patched apps, kept up to date", color = Color.White.copy(alpha = 0.85f))
                }
                IconButton(onClick = onSettings) {
                    Icon(Icons.Rounded.Settings, contentDescription = "Settings", tint = Color.White)
                }
            }
            Spacer(Modifier.height(18.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Stat("$apps", "apps", Modifier.weight(1f))
                Stat("$installed", "installed", Modifier.weight(1f))
                Stat("$updates", if (updates == 1) "update" else "updates", Modifier.weight(1f))
            }
            AnimatedVisibility(visible = updates > 0) {
                Button(
                    onClick = onUpdateAll,
                    modifier = Modifier.fillMaxWidth().padding(top = 16.dp).height(52.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = BrandMid),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Icon(Icons.Rounded.SystemUpdate, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (updates == 1) "Update 1 app" else "Update all $updates apps", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun Stat(value: String, label: String, modifier: Modifier = Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(18.dp))
            .background(Color.White.copy(alpha = 0.16f))
            .padding(vertical = 12.dp, horizontal = 14.dp),
    ) {
        Text(value, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Text(label, color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp)
    }
}

@Composable
private fun Notice(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    text: String,
    action: String?,
    progress: Task? = null,
    onAction: () -> Unit,
) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSecondaryContainer)
                Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSecondaryContainer)
                if (progress != null) TaskProgress(progress, Modifier.padding(top = 8.dp))
            }
            if (action != null) TextButton(onClick = onAction) { Text(action) }
        }
    }
}

@Composable
private fun AppCard(entry: AppEntry, task: Task?, canInstall: Boolean, vm: MainViewModel, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var expanded by rememberSaveable(entry.app.id) { mutableStateOf(false) }
    val app = entry.app
    Card(
        onClick = { expanded = !expanded },
        modifier = modifier.fillMaxWidth().animateContentSize(),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AppIcon(app.icon, app.name)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(app.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(
                        "v${app.versionName} · ${app.patchCount} patches",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                StatusPill(entry.status)
            }
            Text(
                app.about,
                modifier = Modifier.padding(top = 12.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = if (expanded) Int.MAX_VALUE else 2,
                overflow = TextOverflow.Ellipsis,
            )

            if (task != null) {
                TaskProgress(task, Modifier.padding(top = 14.dp))
            } else {
                Row(Modifier.padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val size = entry.file?.size?.let { " · ${it / 1_000_000} MB" }.orEmpty()
                    when (entry.status) {
                        Status.NotInstalled -> Button(onClick = { vm.install(entry) }, enabled = canInstall) {
                            Icon(Icons.Rounded.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Install$size")
                        }
                        Status.UpdateAvailable -> Button(onClick = { vm.install(entry) }, enabled = canInstall) {
                            Icon(Icons.Rounded.SystemUpdate, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Update$size")
                        }
                        Status.UpToDate -> FilledTonalButton(onClick = {
                            vm.launchIntent(app.packageName)?.let(context::startActivity)
                        }) { Text("Open") }
                        Status.OtherSource -> OutlinedButton(onClick = { context.startActivity(vm.uninstallIntent(app.packageName)) }) {
                            Text("Remove other version first")
                        }
                        Status.Unsupported -> OutlinedButton(onClick = {}, enabled = false) { Text("Not available for this phone") }
                    }
                }
            }

            AnimatedVisibility(visible = expanded) {
                Column(Modifier.padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (entry.status == Status.OtherSource) {
                        Detail("Why", "${app.name} on this phone comes from another source (like the Play Store) and is signed differently, so Android can't update it with this build.")
                    }
                    app.helper?.let { helper ->
                        Column(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
                                .background(MaterialTheme.colorScheme.tertiaryContainer).padding(14.dp),
                        ) {
                            Text("Can't log in?", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onTertiaryContainer)
                            Text(
                                "${helper.about} (${helper.versionName})",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onTertiaryContainer,
                            )
                            if (entry.status == Status.OtherSource) {
                                Text(
                                    "Remove the other version first.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                                )
                            } else if (task == null) {
                                FilledTonalButton(onClick = { vm.installHelper(entry) }, enabled = canInstall, modifier = Modifier.padding(top = 8.dp)) {
                                    Text("Install ${helper.name.lowercase()}")
                                }
                            }
                        }
                    }
                    Detail("Package", app.packageName)
                    entry.installedVersion?.let { Detail("Installed", it) }
                    Detail("CPU type", entry.abi ?: "none")
                    Detail("Patches", "${app.patchesRepo} ${app.patchesVersion}")
                    Detail("Released", formatDate(app.releasedAt))
                    if (app.microg) {
                        Detail("Sign-in", "Google sign-in needs MicroG-RE.")
                        TextButton(onClick = {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(MICROG_URL)))
                        }, contentPadding = PaddingValues(0.dp)) { Text("Get MicroG-RE") }
                    }
                    TextButton(onClick = {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(app.releaseUrl)))
                    }, contentPadding = PaddingValues(0.dp)) {
                        Text("Release notes")
                        Spacer(Modifier.width(4.dp))
                        Icon(Icons.Rounded.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp))
                    }
                }
            }
        }
    }
}

private const val MICROG_URL = "https://github.com/MorpheApp/MicroG-RE/releases/latest"

@Composable
private fun AppIcon(url: String?, name: String) {
    val icon = rememberIcon(url)
    Box(
        Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        if (icon != null) {
            Image(icon, contentDescription = "$name icon", modifier = Modifier.fillMaxSize())
        } else {
            Text(name.take(1), fontWeight = FontWeight.Bold, fontSize = 22.sp)
        }
    }
}

@Composable
private fun StatusPill(status: Status) {
    val (text, color) = when (status) {
        Status.NotInstalled -> "Get" to MaterialTheme.colorScheme.outline
        Status.UpToDate -> "Up to date" to Color(0xFF16A34A)
        Status.UpdateAvailable -> "Update" to BrandMid
        Status.OtherSource -> "Other version" to Color(0xFFD97706)
        Status.Unsupported -> "Unavailable" to MaterialTheme.colorScheme.outline
    }
    Surface(shape = CircleShape, color = color.copy(alpha = 0.14f)) {
        Row(Modifier.padding(horizontal = 10.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
            if (status == Status.UpToDate) {
                Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = color, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(4.dp))
            }
            Text(text, color = color, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun TaskProgress(task: Task, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth()) {
        when (task) {
            is Task.Downloading -> {
                val p by animateFloatAsState(task.progress, label = "progress")
                LinearProgressIndicator(progress = { p }, modifier = Modifier.fillMaxWidth().height(6.dp).clip(CircleShape))
                Text("Downloading ${(task.progress * 100).toInt()}%", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 6.dp))
            }
            Task.Installing -> {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth().height(6.dp).clip(CircleShape))
                Text("Installing…", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 6.dp))
            }
        }
    }
}

@Composable
private fun Detail(label: String, value: String) {
    Row {
        Text(label, modifier = Modifier.width(88.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodySmall)
    }
}

private fun formatDate(iso: String): String = runCatching {
    OffsetDateTime.parse(iso).format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault()))
}.getOrDefault(iso)
