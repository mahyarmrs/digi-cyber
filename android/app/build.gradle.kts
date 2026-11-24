import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// The desktop app's version, so every platform of a release carries the same one.
val appVersion: String = providers.gradleProperty("appVersion").getOrElse("0.1.0")
val versionParts = appVersion.split(".").map { it.toIntOrNull() ?: 0 }
val keystore: String? = System.getenv("DC_KEYSTORE")

android {
    namespace = "com.digicyber.client"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.digicyber.client"
        // Android 5.0 and later: every phone and tablet still in use.
        minSdk = 21
        targetSdk = 35
        versionCode = versionParts[0] * 10000 + versionParts.getOrElse(1) { 0 } * 100 + versionParts.getOrElse(2) { 0 }
        versionName = appVersion
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("DC_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("DC_KEY_ALIAS")
                keyPassword = System.getenv("DC_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystore != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    // One APK per processor family, and one universal APK that runs on all of them.
    splits {
        abi {
            isEnable = true
            reset()
            include("armeabi-v7a", "arm64-v8a", "x86", "x86_64")
            isUniversalApk = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    // Xray-core, bound by gomobile from ../core (CI builds it).
    implementation(files("libs/dccore.aar"))
    implementation(platform("androidx.compose:compose-bom:2025.01.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    // QR codes for signing in, read on the phone (ZXing). zxing:core 3.3 keeps Android 5 and 6 working.
    implementation("com.journeyapps:zxing-android-embedded:4.3.0") { isTransitive = false }
    implementation("com.google.zxing:core:3.3.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.1")
    testImplementation("junit:junit:4.13.2")
    // The real org.json for unit tests: android.jar's is a stub that throws.
    testImplementation("org.json:json:20240303")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("junit:junit:4.13.2")
}
