plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

// Núcleo sin dependencias de Android: reglas del registro, cálculo de macros, frontera del
// día, balance y forma de la respuesta. Se prueba en la JVM en segundos, sin emulador.
kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

dependencies {
    implementation(libs.kotlinx.coroutines.core)
    api(libs.kotlinx.serialization.json)
    api(libs.kotlinx.datetime)

    testImplementation(kotlin("test"))
    testImplementation(libs.kotlinx.coroutines.test)
}
