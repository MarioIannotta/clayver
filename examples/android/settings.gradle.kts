pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    // Downloads the JDK 17 toolchain (jvmToolchain(17)) when it isn't installed, so Gradle sync succeeds.
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.10.0"
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
    versionCatalogs {
        // Share versions with the SDK.
        create("libs") { from(files("../../android/gradle/libs.versions.toml")) }
    }
}

rootProject.name = "clayver-android-example"

// Builds the SDK from source: `com.clayver:clayver-android` is substituted by ../../android/clayver.
// In your own app, depend on the published artifact instead.
includeBuild("../../android") {
    dependencySubstitution {
        substitute(module("com.clayver:clayver-android")).using(project(":clayver"))
    }
}

include(":app")
