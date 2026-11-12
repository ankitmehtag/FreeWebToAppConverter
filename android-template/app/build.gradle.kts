import groovy.json.JsonSlurper

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

val sdk = JsonSlurper().parse(rootDir.resolve("version.json")) as Map<*, *>

fun required(name: String): String =
    providers.gradleProperty(name).orNull ?: throw GradleException("Missing Gradle property: $name")

fun optional(name: String): String? = providers.gradleProperty(name).orNull

// Builder containers mount passwords as files, so they never reach the environment.
fun secret(name: String): String =
    optional("${name}File")?.let { file(it).readText().trim() } ?: required(name)

val generatedDir = required("generatedDir")

android {
    namespace = "com.sitetoapk.template"
    compileSdk = sdk["compileSdk"] as Int

    defaultConfig {
        applicationId = required("applicationId")
        minSdk = sdk["minSdk"] as Int
        targetSdk = sdk["targetSdk"] as Int
        versionCode = required("versionCode").toInt()
        versionName = required("versionName")
        // Only the ads flavour reads this; the default is Google's sample app ID, which shows test ads.
        manifestPlaceholders["adsAppId"] = optional("adsAppId") ?: "ca-app-pub-3940256099942544~3347511713"
        buildConfigField("boolean", "WATERMARK", (optional("removeWatermark") != "true").toString())
    }

    // Two flavours, so that an app without ads holds no ad library, no ad component and no advertising ID
    // permission at all: the ads flavour is never built for it. The worker picks one (builder/build.sh).
    flavorDimensions += "ads"
    productFlavors {
        create("noads") { dimension = "ads" }
        create("ads") { dimension = "ads" }
    }

    buildFeatures {
        buildConfig = true
    }

    // Everything specific to one app comes from here, written by the worker or `sample/`.
    sourceSets["main"].apply {
        res.srcDir(file(generatedDir).resolve("res"))
        assets.srcDir(file(generatedDir).resolve("assets"))
    }

    signingConfigs {
        optional("keystorePath")?.let { path ->
            create("release") {
                storeFile = file(path)
                storePassword = secret("keystorePass")
                keyAlias = required("keyAlias")
                keyPassword = secret("keyPass")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(libs.appcompat)
    implementation(libs.browser)
    implementation(libs.core.ktx)
    implementation(libs.core.splashscreen)
    implementation(libs.firebase.messaging)
    implementation(libs.swiperefresh)
    implementation(libs.webkit)
    "adsImplementation"(libs.play.services.ads)
    "adsImplementation"(libs.ump)
    testImplementation(libs.junit)
    testImplementation(libs.org.json)
}
