plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "app.potalker.android"
    compileSdk = 34
    defaultConfig {
        applicationId = "app.potalker.android"
        minSdk = 29                 // Android 10 以降
        targetSdk = 34
        versionCode = 2
        versionName = "0.1.0"
    }
    // リリース用の署名：鍵は、リポジトリの外（~/Documents/potalk-keys/）に置く。パスワードは、Mac のキーチェーンから読む（環境変数 POTALKER_KEYSTORE_PASSWORD でも渡せる）。
    // 鍵がない環境（他の人が取ってきたとき）では、署名なしのリリース版になる（デバッグ版のビルドには、影響しない）
    val keystoreFile = file(System.getProperty("user.home") + "/Documents/potalk-keys/potalker-release.jks")
    val keystorePassword: String? = System.getenv("POTALKER_KEYSTORE_PASSWORD") ?: runCatching {
        val p = ProcessBuilder("security", "find-generic-password", "-a", "potalker-android", "-s", "potalker-android-keystore", "-w").redirectErrorStream(false).start()
        p.inputStream.bufferedReader().readText().trim().also { p.waitFor() }
    }.getOrNull()?.takeIf { it.isNotEmpty() }
    if (keystoreFile.exists() && keystorePassword != null) {
        signingConfigs {
            create("release") {
                storeFile = keystoreFile; storePassword = keystorePassword
                keyAlias = "potalker"; keyPassword = keystorePassword
            }
        }
        buildTypes { getByName("release") { signingConfig = signingConfigs.getByName("release") } }
    }
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.03")
    implementation(composeBom)
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
}
