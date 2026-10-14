# MacrAI para Android

App Android (Kotlin + Jetpack Compose) del registro de macros por chat. El plan completo está en [`docs/migracion-android.md`](../docs/migracion-android.md) y las reglas del asistente en [`docs/asistente/comportamiento-chat-macros.md`](../docs/asistente/comportamiento-chat-macros.md).

```
mobile/
├── core/         Reglas y cálculos en Kotlin puro (sin Android), con tests
└── androidApp/   App Compose: chat, semana, catálogo, IA, OCR, voz y Health Connect
```

## Probarla en tu móvil

### 1. Requisitos

- Android Studio reciente (Narwhal o posterior), con el JDK que trae integrado.
- Un móvil con Android 8.0 (API 26) o superior y la depuración USB activada (Ajustes → Información del teléfono → pulsar 7 veces "Número de compilación" → Opciones de desarrollador → Depuración USB).

### 2. Abrir el proyecto

```bash
git clone https://github.com/Ismagac/MacrAI.git
cd MacrAI
git checkout feature/app-android
```

En Android Studio: **File → Open → la carpeta `mobile/`** (no la raíz del repo, que es la web). Espera a que termine el *Gradle sync*. Si Studio propone actualizar el plugin de Android o Kotlin, puedes aceptarlo.

### 3. Conectar la IA (Firebase, gratis para probar)

Sin este paso la app se abre, pero el chat responde "Falta conectar la IA".

1. En [console.firebase.google.com](https://console.firebase.google.com), crea un proyecto (el plan gratuito Spark vale).
2. **Añadir app → Android**, con el nombre de paquete **`app.macrai`**. No hace falta la huella SHA-1.
3. Descarga `google-services.json` y cópialo en **`mobile/androidApp/google-services.json`**. Está en `.gitignore`: no se sube al repo.
4. En la consola, **AI Logic → Get started → Gemini Developer API**.
5. No actives todavía la verificación obligatoria de **App Check**: si la activas, la build de depuración necesita un token de depuración.

### 4. Ejecutar

Conecta el móvil, elígelo arriba en Studio y pulsa **Run ▶**. La primera build tarda unos minutos.

### Tests del núcleo

```bash
cd mobile
./gradlew :core:test
```

No necesitan móvil ni emulador.

## Cosas a tener en cuenta en la primera prueba

- **Primera compilación:** el módulo Android se escribió en un entorno sin acceso al repositorio Maven de Google, así que no se ha compilado nunca. Si falla algo, casi seguro será un import o una versión en `ai/HybridLanguageModel.kt` (la API híbrida de Firebase es experimental). El núcleo sí está compilado y probado.
- **Si el chat contesta "No he podido interpretarlo":** abre Logcat y filtra por `MacrAI-IA`. Ahí sale el error real: modelo no encontrado, cuota, falta de red… Los nombres de modelo están al principio de `HybridLanguageModel.kt`.
- **Gemini Nano:** solo existe en móviles recientes con AICore (Pixel 9/10, Galaxy S25/S26 y similares). En los demás, todo va a la nube sin que tengas que hacer nada. La primera vez, el móvil puede tardar en descargar el modelo.
- **Voz:** usa el reconocedor del sistema. Para dictar sin conexión, descarga el paquete de voz en español (Ajustes → Google → Voz o el equivalente en Samsung). En Samsung, si el dictado falla, elige el reconocedor de Google como servicio de voz predeterminado.
- **Health Connect:** en Samsung Health, activa la sincronización con Health Connect (Samsung Health → Ajustes → Health Connect) y concede peso y calorías. Después, en la pestaña **Semana**, pulsa "Importar peso y gasto de Health Connect". Si no hay datos, la captura del reloj sigue funcionando desde el chat.
- **Mínimo de proteína:** sale de tu peso (1,5 g/kg). Hasta que registres un peso ("apunta 92,6 para el peso") o lo importes de Health Connect, no se muestra.
- **Datos:** de momento se guardan solo en el móvil (`registro.json`). Desinstalar la app los borra. Las cuentas y la sincronización con Supabase son la fase 2 del plan.
- **Tu catálogo:** empieza vacío. Tu catálogo de las semanas de prueba está en `docs/datos/catalogo-inicial.md` y se importará en la fase 2. Mientras tanto, la app aprende de lo que registres y de las etiquetas que fotografíes.
- **Cuotas:** la capa gratuita de Gemini tiene límites diarios por proyecto. Para probar tú solo sobran; para publicar hace falta el plan de pago (ver el plan).
