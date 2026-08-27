plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android { namespace="com.luckybox.gateway"; compileSdk=35; buildToolsVersion="35.0.0"
  defaultConfig { applicationId="com.luckybox.gateway"; minSdk=26; targetSdk=35; versionCode=2; versionName="1.1" }
  signingConfigs { getByName("debug") { storeFile=file("debug.keystore"); storePassword="android"; keyAlias="androiddebugkey"; keyPassword="android" } }
  compileOptions { sourceCompatibility=JavaVersion.VERSION_17; targetCompatibility=JavaVersion.VERSION_17 }
  kotlinOptions { jvmTarget="17" }
}
dependencies {
  implementation("androidx.core:core-ktx:1.15.0")
  implementation("androidx.work:work-runtime-ktx:2.10.0")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
