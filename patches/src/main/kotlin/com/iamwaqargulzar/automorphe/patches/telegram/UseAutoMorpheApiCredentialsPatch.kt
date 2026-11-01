package com.iamwaqargulzar.automorphe.patches.telegram

import app.morphe.patcher.extensions.InstructionExtensions.addInstruction
import app.morphe.patcher.extensions.InstructionExtensions.addInstructions
import app.morphe.patcher.patch.Compatibility
import app.morphe.patcher.patch.PatchException
import app.morphe.patcher.patch.bytecodePatch
import app.morphe.patcher.patch.resourcePatch
import com.android.tools.smali.dexlib2.Opcode
import com.android.tools.smali.dexlib2.iface.instruction.OffsetInstruction
import com.android.tools.smali.dexlib2.iface.instruction.ReferenceInstruction
import com.android.tools.smali.dexlib2.iface.instruction.SwitchPayload
import com.android.tools.smali.dexlib2.iface.instruction.formats.Instruction3rc
import com.android.tools.smali.dexlib2.iface.reference.FieldReference
import com.android.tools.smali.dexlib2.iface.reference.MethodReference

private const val PATCH = "Use API credentials from Auto Morphe"
private const val EXTENSION = "Lcom/iamwaqargulzar/automorphe/extension/TelegramApi;"
private const val BUILD_VARS = "Lorg/telegram/messenger/BuildVars;"
private const val CONNECTIONS = "Lorg/telegram/tgnet/ConnectionsManager;"
private const val AUTO_MORPHE = "com.iamwaqargulzar.automorphe"

private val telegram = Compatibility(name = "Telegram", packageName = "org.telegram.messenger")

/** Lets Telegram see Auto Morphe's provider (package visibility on Android 11+). */
private val autoMorpheVisibilityPatch = resourcePatch {
    execute {
        document("AndroidManifest.xml").use { doc ->
            val manifest = doc.documentElement
            val queries = (0 until manifest.childNodes.length).map { manifest.childNodes.item(it) }
                .firstOrNull { it.nodeName == "queries" } ?: doc.createElement("queries").also { manifest.appendChild(it) }
            val pkg = doc.createElement("package")
            pkg.setAttribute("android:name", AUTO_MORPHE)
            queries.appendChild(pkg)
        }
    }
}

/**
 * Telegram refuses the official app's API ID from modified clients
 * (API_ID_PUBLISHED_FLOOD). This reads the user's own ID and hash from
 * Auto Morphe at startup, so nothing secret is baked into the APK.
 */
@Suppress("unused")
val useAutoMorpheApiCredentialsPatch = bytecodePatch(
    name = PATCH,
    description = "Signs in with your own API ID and hash, which Auto Morphe gets from my.telegram.org and keeps on " +
        "your phone. Without them, Telegram keeps its built-in ID.",
    default = true,
) {
    compatibleWith(telegram)
    dependsOn(autoMorpheVisibilityPatch)
    extendWith("extensions/automorphe.mpe")

    execute {
        val buildVars = classDefBy(BUILD_VARS)
        for ((name, type) in listOf("APP_ID" to "I", "APP_HASH" to "Ljava/lang/String;")) {
            val field = buildVars.fields.singleOrNull { it.name == name && it.type == type }
                ?: throw PatchException("$PATCH: BuildVars.$name is missing")
            if (field.accessFlags and FINAL != 0) throw PatchException("$PATCH: BuildVars.$name is final")
        }

        val connections = mutableClassDefBy(CONNECTIONS)

        // 1. Load the credentials before the constructor reads BuildVars.APP_ID.
        val constructor = connections.methods.singleOrNull { it.name == "<init>" && it.parameterTypes.map(CharSequence::toString) == listOf("I") }
            ?: throw PatchException("$PATCH: ConnectionsManager(int) not found")
        val readsId = constructor.implementation!!.instructions.any {
            ((it as? ReferenceInstruction)?.reference as? FieldReference)?.let { f -> f.definingClass == BUILD_VARS && f.name == "APP_ID" } == true
        }
        if (!readsId) throw PatchException("$PATCH: ConnectionsManager(int) no longer reads BuildVars.APP_ID")
        constructor.addInstruction(0, "invoke-static {}, $EXTENSION->apply()V")

        // 2. Mix the ID into the version passed to native_init (argument 1), so a new ID re-sends initConnection.
        val (init, index) = connections.methods.firstNotNullOfOrNull { method ->
            method.implementation?.instructions?.indexOfFirst {
                it.opcode == Opcode.INVOKE_STATIC_RANGE &&
                    ((it as ReferenceInstruction).reference as MethodReference).let { m -> m.definingClass == CONNECTIONS && m.name == "native_init" }
            }?.takeIf { it >= 0 }?.let { method to it }
        } ?: throw PatchException("$PATCH: native_init call not found")
        val instructions = init.implementation!!.instructions.toList()
        val call = instructions[index] as Instruction3rc
        val reference = call.reference as MethodReference
        if (reference.parameterTypes.size < 4 || reference.parameterTypes[1].toString() != "I") {
            throw PatchException("$PATCH: native_init signature changed")
        }
        // Code inserted before the call must run on every path to it: nothing may jump straight to it.
        val offsets = instructions.runningFold(0) { at, insn -> at + insn.codeUnits }
        val callOffset = offsets[index]
        val jumpsToCall = instructions.withIndex().any { (i, insn) ->
            insn is OffsetInstruction && insn.opcode.name.let { it.startsWith("goto") || it.startsWith("if-") } &&
                offsets[i] + insn.codeOffset == callOffset
        } || instructions.any { it is SwitchPayload }
        if (jumpsToCall) throw PatchException("$PATCH: native_init call is a branch target")
        val version = call.startRegister + 1
        init.addInstructions(
            index,
            """
                invoke-static/range {v$version .. v$version}, $EXTENSION->version(I)I
                move-result v$version
            """,
        )
    }
}

private const val FINAL = 0x10
