import com.vanniktech.maven.publish.AndroidSingleVariantLibrary

plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.vanniktech.maven.publish)
}

group = "com.clayver"
version = "0.3.1"

android {
    namespace = "com.clayver.sdk"
    compileSdk = 35

    defaultConfig {
        minSdk = 23
        consumerProguardFiles("consumer-rules.pro")
        buildConfigField("String", "SDK_VERSION", "\"${project.version}\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    jvmToolchain(17)
    explicitApi()
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)

    implementation(platform(libs.compose.bom))
    api(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.core)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)

    api(platform(libs.firebase.bom))
    api(libs.firebase.auth)
    implementation(libs.firebase.database)
    implementation(libs.firebase.storage)
    implementation(libs.firebase.functions)
    api(libs.firebase.messaging)

    api(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.coil.compose)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}

// Publishing (com.vanniktech.maven.publish). The plugin configures the "release"
// variant with sources and javadoc jars.
//
//   ./gradlew :clayver:publishToMavenLocal               -> ~/.m2, com.clayver:clayver-android:<version>
//   ./gradlew :clayver:publishAndReleaseToMavenCentral   -> Maven Central (release workflow)
//
// Maven Central needs these Gradle properties, which CI passes as
// ORG_GRADLE_PROJECT_<name> environment variables (see docs/releasing.md):
// mavenCentralUsername, mavenCentralPassword (a Central Portal user token),
// signingInMemoryKey (ASCII-armored GPG private key), signingInMemoryKeyPassword
// and optionally signingInMemoryKeyId. Without a signing key, publications are
// left unsigned so local and composite builds keep working.
mavenPublishing {
    configure(AndroidSingleVariantLibrary(variant = "release", sourcesJar = true, publishJavadocJar = true))
    coordinates("com.clayver", "clayver-android", project.version.toString())
    publishToMavenCentral()
    if (providers.gradleProperty("signingInMemoryKey").isPresent) {
        signAllPublications()
    }

    pom {
        name.set("Clayver Android SDK")
        description.set("Open-source in-app customer support for Android, backed by your own Firebase project.")
        inceptionYear.set("2026")
        url.set("https://github.com/MarioIannotta/clayver")
        licenses {
            license {
                name.set("Apache-2.0")
                url.set("https://www.apache.org/licenses/LICENSE-2.0.txt")
                distribution.set("repo")
            }
        }
        developers {
            developer {
                id.set("clayver")
                name.set("Clayver contributors")
                email.set("oss@clayver.dev")
                url.set("https://github.com/MarioIannotta/clayver/graphs/contributors")
            }
        }
        scm {
            url.set("https://github.com/MarioIannotta/clayver")
            connection.set("scm:git:https://github.com/MarioIannotta/clayver.git")
            developerConnection.set("scm:git:ssh://git@github.com/MarioIannotta/clayver.git")
        }
        issueManagement {
            system.set("GitHub")
            url.set("https://github.com/MarioIannotta/clayver/issues")
        }
    }
}
