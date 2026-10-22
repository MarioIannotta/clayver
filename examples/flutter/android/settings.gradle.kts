pluginManagement {
    val flutterSdkPath =
        run {
            val properties = java.util.Properties()
            file("local.properties").inputStream().use { properties.load(it) }
            val flutterSdkPath = properties.getProperty("flutter.sdk")
            require(flutterSdkPath != null) { "flutter.sdk not set in local.properties" }
            flutterSdkPath
        }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.android.application") version "9.1.0" apply false
    id("org.jetbrains.kotlin.android") version "2.4.0" apply false
}

include(":app")

// The plugin pulls `com.marioiannotta.clayver:clayver-android` from Maven Central.
// To build the native SDK from this repository instead, run with
// -Pclayver.localSdk=true (or set it in gradle.properties).
if (providers.gradleProperty("clayver.localSdk").orNull == "true") {
    includeBuild("../../../android") {
        dependencySubstitution {
            substitute(module("com.marioiannotta.clayver:clayver-android")).using(project(":clayver"))
        }
    }
}
