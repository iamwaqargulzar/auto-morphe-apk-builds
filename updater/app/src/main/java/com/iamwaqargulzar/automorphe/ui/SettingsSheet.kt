package com.iamwaqargulzar.automorphe.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.iamwaqargulzar.automorphe.BuildConfig

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsSheet(vm: MainViewModel, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var autoCheck by remember { mutableStateOf(vm.prefs.autoCheck) }
    var wifiOnly by remember { mutableStateOf(vm.prefs.wifiOnly) }
    var abi by remember { mutableStateOf(vm.prefs.abiOverride) }
    val site = vm.state.value.feed?.site ?: "https://apk.iamwaqargulzar.com"

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("Settings", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)

            Toggle("Check for updates automatically", "Every 6 hours, with a notification when something is new.", autoCheck) {
                autoCheck = it
                vm.setAutoCheck(it)
            }
            Toggle("Only on Wi-Fi", "Background checks wait for an unmetered network.", wifiOnly) {
                wifiOnly = it
                vm.setWifiOnly(it)
            }

            Column {
                Text("CPU type", fontWeight = FontWeight.SemiBold)
                Text(
                    "Automatic uses ${Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown"}. Change only if installs fail.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(null to "Automatic", "arm64-v8a" to "64-bit", "armeabi-v7a" to "32-bit").forEach { (value, label) ->
                        FilterChip(selected = abi == value, onClick = { abi = value; vm.setAbi(value) }, label = { Text(label) })
                    }
                }
            }

            HorizontalDivider()

            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("About", fontWeight = FontWeight.SemiBold)
                Text("Auto Morphe ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall)
                Text("Apps are verified against this signing certificate (SHA-256):", style = MaterialTheme.typography.bodySmall)
                Text(
                    BuildConfig.CERT_SHA256.chunked(2).joinToString(":").uppercase(),
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                )
                Spacer(Modifier.height(4.dp))
                TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(site))) }) {
                    Text("Open the website")
                }
            }
        }
    }
}

@Composable
private fun Toggle(title: String, subtitle: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
