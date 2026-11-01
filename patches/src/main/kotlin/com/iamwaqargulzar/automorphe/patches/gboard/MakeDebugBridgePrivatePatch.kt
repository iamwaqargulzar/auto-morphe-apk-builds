package com.iamwaqargulzar.automorphe.patches.gboard

import app.morphe.patcher.patch.Compatibility
import app.morphe.patcher.patch.PatchException
import app.morphe.patcher.patch.resourcePatch
import org.w3c.dom.Element

private const val PATCH = "Make debug bridge private"
private const val PROVIDER = "com.google.android.libraries.inputmethod.webdebugbridge.WebDebugBridgeContentProvider"

private val gboard = Compatibility(name = "Gboard", packageName = "com.google.android.inputmethod.latin")

/**
 * Gboard's WebDebugBridge provider is exported and lets in two Google package
 * names only if they carry Google's signature. "Add Gboard Signature Bypass"
 * makes that signature check always pass, so any app using one of those names
 * could reach Gboard's settings, flags and training data. Nothing outside
 * Gboard needs the bridge, so this closes it to other apps.
 */
@Suppress("unused")
val makeDebugBridgePrivatePatch = resourcePatch(
    name = PATCH,
    description = "Stops other apps from reaching Gboard's debug bridge, which the signature bypass would otherwise open " +
        "to any app using a Google debug-tool package name.",
    default = true,
) {
    compatibleWith(gboard)

    execute {
        document("AndroidManifest.xml").use { doc ->
            val providers = doc.getElementsByTagName("provider")
            val provider = (0 until providers.length).map { providers.item(it) as Element }
                .singleOrNull { it.getAttribute("android:name") == PROVIDER }
                ?: throw PatchException("$PATCH: WebDebugBridgeContentProvider not found")
            provider.setAttribute("android:exported", "false")
        }
    }
}
