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
        buildConfigField("boolean", "WATERMARK", (optional("removeWatermark") != "true").toString())
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
    testImplementation(libs.junit)
    testImplementation(libs.org.json)
}
