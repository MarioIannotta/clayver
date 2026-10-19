plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

android {
    namespace = "com.example.shop"
    defaultConfig {
        applicationId = "com.example.shop"
        minSdk = 24
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
}
