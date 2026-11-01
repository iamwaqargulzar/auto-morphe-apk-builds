import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// Auto Morphe's own Morphe patches, built into patches-<version>.mpp.
//
// The patches compile against the Morphe CLI jar the build tool already
// downloads (it bundles the patcher), so no GitHub Packages login is needed:
//   ./gradlew build -PmorpheJar=../.cache/tools/morphe-desktop-<v>-all.jar
// The extension (Java run inside the patched app) is compiled against
// android.jar and turned into dex with d8 from the Android SDK.

plugins {
    kotlin("jvm") version "2.4.21"
}

group = "com.iamwaqargulzar.automorphe"

val morpheJar = providers.gradleProperty("morpheJar").orNull?.let(::file)
    ?: rootDir.resolve("../.cache/tools").listFiles { f -> f.name.matches(Regex("morphe-desktop-.*-all\\.jar")) }
        ?.maxByOrNull { it.name }
    ?: error("Morphe CLI jar not found: pass -PmorpheJar=<path>")

val sdk = file(System.getenv("ANDROID_HOME") ?: System.getenv("ANDROID_SDK_ROOT") ?: "${System.getProperty("user.home")}/Android/Sdk")
fun newest(dir: String) = sdk.resolve(dir).listFiles()?.filter { it.isDirectory }?.maxByOrNull { it.name }
    ?: error("No $dir in the Android SDK at $sdk")
val androidJar = newest("platforms").resolve("android.jar")
val d8 = newest("build-tools").resolve("d8")

dependencies {
    compileOnly(files(morpheJar))
}

kotlin {
    jvmToolchain(21)
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

val compileExtension by tasks.registering(JavaCompile::class) {
    source = fileTree("extension/src")
    classpath = files(androidJar)
    destinationDirectory.set(layout.buildDirectory.dir("extension/classes"))
    options.release.set(11)
}

val dexExtension by tasks.registering(Exec::class) {
    dependsOn(compileExtension)
    val classes = layout.buildDirectory.dir("extension/classes")
    val out = layout.buildDirectory.dir("extension/dex")
    inputs.dir(classes)
    outputs.dir(out)
    doFirst { out.get().asFile.mkdirs() }
    executable = d8.path
    argumentProviders.add(CommandLineArgumentProvider {
        listOf("--release", "--min-api", "26", "--lib", androidJar.path, "--output", out.get().asFile.path) +
            classes.get().asFileTree.matching { include("**/*.class") }.files.map { it.path }
    })
}

tasks.jar {
    archiveFileName.set("patches-$version.mpp")
    from(dexExtension.map { layout.buildDirectory.file("extension/dex/classes.dex") }) {
        into("extensions")
        rename { "automorphe.mpe" }
    }
    manifest {
        attributes(
            "Name" to "Auto Morphe Patches",
            "Description" to "Auto Morphe's own patches, such as your own Telegram API credentials and a safer Gboard.",
            "Version" to version,
            "Source" to "https://github.com/iamwaqargulzar/auto-morphe-apk-builds/tree/main/patches",
            "Author" to "Waqar Gulzar",
            "Contact" to "https://github.com/iamwaqargulzar/auto-morphe-apk-builds/issues",
            "Website" to "https://apk.iamwaqargulzar.com",
            "License" to "MIT",
        )
    }
}
