plugins { id("com.android.application") }
android {
    namespace = "dev.amadeus.kurisu"
    compileSdk = 37
    defaultConfig {
        applicationId = "dev.amadeus.kurisu"
        minSdk = 26
        targetSdk = 37
        versionCode = 18
        versionName = "0.6.8"
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets["main"].assets.srcDir("../../dist")
    androidResources { ignoreAssetsPattern = "!.git:!reference:!*.md" }
}
