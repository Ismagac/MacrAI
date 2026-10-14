plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

// Firebase AI Logic necesita google-services.json (consola de Firebase → Android).
// Sin él la app compila igual, pero el modelo no podrá llamar a la nube.
if (file("google-services.json").exists()) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
}

android {
    namespace = "app.macrai.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.macrai"
        // 26 es el mínimo de Health Connect y de la Prompt API de Gemini Nano.
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures { compose = true }

    // El documento de comportamiento es la fuente única del system prompt de la nube.
    sourceSets["main"].assets.srcDir("../../docs/asistente")
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    implementation(project(":core"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.extended)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.kotlinx.coroutines.play.services)

    // IA: Gemini Nano en el dispositivo con la nube de respaldo (Firebase AI Logic, modo híbrido)
    implementation(libs.firebase.ai)
    implementation(libs.firebase.ai.ondevice)
    // OCR de etiquetas en el dispositivo, gratis y en cualquier móvil
    implementation(libs.mlkit.text.recognition)
    // Código de barras (EAN) en la foto: identifica el producto en Open Food Facts
    implementation(libs.mlkit.barcode.scanning)
    // Peso y gasto del reloj (Samsung Health escribe en Health Connect)
    implementation(libs.health.connect)
}
