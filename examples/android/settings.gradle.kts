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

// The app depends on `com.marioiannotta.clayver:clayver-android` from Maven Central,
// like any app would. To build the SDK from this repository instead, run Gradle
// with -Pclayver.localSdk=true (or set it in gradle.properties).
if (providers.gradleProperty("clayver.localSdk").orNull == "true") {
    includeBuild("../../android") {
        dependencySubstitution {
            substitute(module("com.marioiannotta.clayver:clayver-android")).using(project(":clayver"))
        }
    }
}

include(":app")
