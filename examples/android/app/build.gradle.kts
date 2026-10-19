import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    // Reads app/google-services.json (not committed; see README.md).
    alias(libs.plugins.google.services)
}

// The application id must match the Android app registered in your Firebase project
// (google-services.json). Override it without editing this file by adding
// `clayver.applicationId=your.package` to local.properties (not committed).
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) {
        file.inputStream().use { stream -> load(stream) }
    }
}

// When local.properties doesn't set it, use the package google-services.json registers
// (when it registers exactly one), so the build matches your Firebase app out of the box.
@Suppress("UNCHECKED_CAST")
val googleServicesPackage: String? = file("google-services.json").takeIf { it.exists() }?.let { json ->
    val clients = (groovy.json.JsonSlurper().parse(json) as Map<String, Any?>)["client"] as? List<Map<String, Any?>>
    val packages = clients.orEmpty().mapNotNull {
        ((it["client_info"] as? Map<String, Any?>)?.get("android_client_info") as? Map<String, Any?>)?.get("package_name") as? String
    }.distinct()
    packages.singleOrNull()
}

android {
    namespace = "com.clayver.example"
    compileSdk = 35

    defaultConfig {
        applicationId = localProperties.getProperty("clayver.applicationId") ?: googleServicesPackage ?: "com.clayver.example"
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildFeatures { compose = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation("com.clayver:clayver-android:0.1.0")

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.firebase.auth)
    implementation(libs.kotlinx.coroutines.play.services)
}
