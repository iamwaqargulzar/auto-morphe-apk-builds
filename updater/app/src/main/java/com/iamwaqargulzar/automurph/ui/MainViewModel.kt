package com.iamwaqargulzar.automurph.ui

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.iamwaqargulzar.automurph.BuildConfig
import com.iamwaqargulzar.automurph.data.AppEntry
import com.iamwaqargulzar.automurph.data.Feed
import com.iamwaqargulzar.automurph.data.FeedClient
import com.iamwaqargulzar.automurph.data.Prefs
import com.iamwaqargulzar.automurph.data.Status
import com.iamwaqargulzar.automurph.data.entries
import com.iamwaqargulzar.automurph.install.InstallResult
import com.iamwaqargulzar.automurph.install.Installer
import com.iamwaqargulzar.automurph.work.UpdateWorker
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** What a card is doing right now. */
sealed interface Task {
    data class Downloading(val progress: Float) : Task
    data object Installing : Task
}

data class UiState(
    val loading: Boolean = true,
    val feed: Feed? = null,
    val entries: List<AppEntry> = emptyList(),
    val tasks: Map<String, Task> = emptyMap(),
    val error: String? = null,
    val message: String? = null,
    val selfUpdate: Boolean = false,
    val selfTask: Task? = null,
) {
    val updates get() = entries.count { it.status == Status.UpdateAvailable }
    val installed get() = entries.count { it.status == Status.UpToDate || it.status == Status.UpdateAvailable }
}

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val context get() = getApplication<Application>()
    val prefs = Prefs(app)
    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state

    /** package → build being installed, recorded once Android confirms. */
    private val pending = mutableMapOf<String, String>()

    init {
        FeedClient.cached(app)?.let { feed -> _state.update { it.copy(feed = feed, entries = entries(feed, app.packageManager, prefs)) } }
        refresh()
        viewModelScope.launch {
            Installer.events.collect { result ->
                when (result) {
                    is InstallResult.Success -> {
                        pending.remove(result.packageName)?.let { prefs.setInstalledBuild(result.packageName, it) }
                        _state.update { s -> s.copy(tasks = s.tasks - result.packageName, message = "Installed") }
                        recompute()
                    }
                    is InstallResult.Failure -> {
                        pending.remove(result.packageName)
                        _state.update { s -> s.copy(tasks = s.tasks - result.packageName, selfTask = null, message = result.message) }
                    }
                }
            }
        }
    }

    fun refresh() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            FeedClient.load(context)
                .onSuccess { feed ->
                    _state.update {
                        it.copy(
                            loading = false,
                            feed = feed,
                            entries = entries(feed, context.packageManager, prefs),
                            selfUpdate = (feed.updater?.versionCode ?: 0) > BuildConfig.VERSION_CODE,
                        )
                    }
                }
                .onFailure { err -> _state.update { it.copy(loading = false, error = err.message ?: "Couldn't reach the server") } }
        }
    }

    /** Re-reads installed apps (after an install, uninstall or returning to the app). */
    fun recompute() {
        val feed = _state.value.feed ?: return
        _state.update { it.copy(entries = entries(feed, context.packageManager, prefs)) }
    }

    fun install(entry: AppEntry) = install(entry, entry.file, entry.app.build)

    /** Installs the app's helper build (same package), e.g. Reddit's login helper. */
    fun installHelper(entry: AppEntry) {
        val helper = entry.app.helper ?: return
        install(entry, entry.abi?.let { helper.files[it] }, helper.build)
    }

    private fun install(entry: AppEntry, file: com.iamwaqargulzar.automurph.data.FeedFile?, build: String) {
        file ?: return
        val pkg = entry.app.packageName
        if (pkg in _state.value.tasks) return
        viewModelScope.launch {
            setTask(pkg, Task.Downloading(0f))
            runCatching {
                val apk = Installer.download(context, file.url, file.sha256) { p -> setTask(pkg, Task.Downloading(p)) }
                setTask(pkg, Task.Installing)
                pending[pkg] = build
                Installer.install(context, apk, pkg)
            }.onFailure { err ->
                _state.update { s -> s.copy(tasks = s.tasks - pkg, message = err.message ?: "Download failed") }
            }
        }
    }

    fun updateAll() {
        _state.value.entries.filter { it.status == Status.UpdateAvailable }.forEach { install(it) }
    }

    fun installSelfUpdate() {
        val updater = _state.value.feed?.updater ?: return
        viewModelScope.launch {
            _state.update { it.copy(selfTask = Task.Downloading(0f)) }
            runCatching {
                val apk = Installer.download(context, updater.url, updater.sha256) { p ->
                    _state.update { it.copy(selfTask = Task.Downloading(p)) }
                }
                _state.update { it.copy(selfTask = Task.Installing) }
                Installer.install(context, apk, context.packageName)
            }.onFailure { err -> _state.update { it.copy(selfTask = null, message = err.message) } }
        }
    }

    /** Opens Android's uninstall dialog, e.g. for the Play Store version of an app. */
    fun uninstallIntent(packageName: String): Intent =
        Intent(Intent.ACTION_DELETE, Uri.parse("package:$packageName")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun launchIntent(packageName: String): Intent? = context.packageManager.getLaunchIntentForPackage(packageName)

    fun consumeMessage() = _state.update { it.copy(message = null) }

    fun setAutoCheck(on: Boolean) {
        prefs.autoCheck = on
        UpdateWorker.schedule(context)
    }

    fun setWifiOnly(on: Boolean) {
        prefs.wifiOnly = on
        UpdateWorker.schedule(context)
    }

    fun setAbi(abi: String?) {
        prefs.abiOverride = abi
        recompute()
    }

    private fun setTask(pkg: String, task: Task) = _state.update { s -> s.copy(tasks = s.tasks + (pkg to task)) }
}
