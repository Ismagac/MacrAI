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

### 4. Cuentas y sincronización (Supabase, opcional)

Sin este paso todo funciona, pero solo en el móvil. Con él, el registro, el catálogo, los alias, el peso, el gasto y los ajustes se guardan en tu cuenta, llegan a cualquier móvil con la misma cuenta y tu historial de la web aparece en la app.

1. En el proyecto de Supabase que ya usa la web (o en uno nuevo), aplica en orden las migraciones **015, 016 y 017** de `supabase/migrations/`: desde el SQL Editor pegando cada archivo, o con `supabase db push` si usas la CLI. La 016 borra lo de Telegram y no se puede deshacer.
2. En **Authentication → Providers**, deja activado **Email**. Si mantienes "Confirm email", al crear la cuenta llega un enlace que hay que abrir antes de entrar.
3. En **Project Settings → API**, copia la *Project URL* y la clave *anon public* a `mobile/local.properties` (Android Studio crea ese archivo; no se sube al repo):

   ```properties
   MACRAI_SUPABASE_URL=https://xxxxxxxx.supabase.co
   MACRAI_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```

4. Vuelve a compilar. En **Ajustes → Cuenta** podrás entrar o crear la cuenta.

### 5. Catálogo global de supermercados (opcional)

Llena `alimentos_global` con los productos de Mercadona (nombre, EAN, formato, foto y precio) cruzados con Open Food Facts por EAN, para que el chat los encuentre sin escanear nada.

- **A mano, desde tu ordenador:** `npm run catalogo:importar -- --prueba --limite 50` solo cuenta lo que encontraría. Sin `--prueba` y con `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el entorno, escribe. La *service role key* está en Project Settings → API y nunca debe ir en la app.
- **Cada semana, automático:** en GitHub, **Settings → Secrets and variables → Actions**, crea `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. El workflow `Catálogo global` corre los lunes y también se lanza a mano desde la pestaña Actions, una vez el workflow esté en la rama principal.
- **Aviso:** la API de la tienda de Mercadona no es oficial y su `robots.txt` pide no rastrear `/api`. Puede cambiar o cerrarse sin aviso, y para una app publicada hay que valorar ese riesgo.

### 6. Ejecutar

Conecta el móvil, elígelo arriba en Studio y pulsa **Run ▶**. La primera build tarda unos minutos.

### Tests del núcleo

```bash
cd mobile
./gradlew :core:test
```

No necesitan móvil ni emulador.

## Qué funciona en esta versión

| Función | Estado |
|---|---|
| Chat por texto y voz, con las reglas del documento (día que no cambia a medianoche, comida por contexto, supuestos visibles, correcciones) | Sí |
| Foto de etiqueta: OCR en el móvil y validación kcal ≈ 4P + 4C + 9G | Sí |
| Código de barras en la foto → producto del catálogo global o de Open Food Facts | Sí |
| Productos de marca que no estén en tu catálogo ("pechuga de pavo Hacendado") → catálogo global y, si no está, Open Food Facts | Sí |
| Importar tu catálogo en Markdown (`docs/datos/catalogo-inicial.md`) con sus alias | Sí |
| Catálogo personal: búsqueda tolerante a errores, edición de valores, peso por unidad, borrar | Sí |
| Alias: "cuando diga X me refiero a Y", alias a mano en la ficha, y el chat te propone uno cuando llamas a algo siempre igual | Sí |
| Control manual del día: tocar una comida, cambiar gramos, moverla de comida o borrarla | Sí |
| Peso, gasto y pasos de Health Connect; balance semanal y estimación del mantenimiento | Sí |
| Ajustes: peso, proteína por kg y objetivo de déficit | Sí |
| Cuentas con email y contraseña, sincronización entre móviles y con la web, borrar la cuenta | Sí, con Supabase configurado (paso 4) |
| Catálogo global: Mercadona + Open Food Facts, semanal | Sí, con el importador (paso 5) |
| Etiquetas con código de barras que fotografías → se aportan al catálogo global para todos | Sí, con cuenta |
| Otros supermercados (Dia, Carrefour, Lidl…) | No todavía: el importador está preparado para añadir fuentes |
| Iniciar sesión con Google | No todavía: necesita configurar OAuth en Google Cloud y Supabase |

## Cosas a tener en cuenta en la primera prueba

- **Primera compilación:** el módulo Android se escribió en un entorno sin acceso al repositorio Maven de Google, así que no se ha compilado nunca. Si falla algo, casi seguro será un import o una versión en `ai/HybridLanguageModel.kt` (la API híbrida de Firebase es experimental). El núcleo sí está compilado y probado.
- **Si el chat contesta "No he podido interpretarlo":** abre Logcat y filtra por `MacrAI-IA`. Ahí sale el error real: modelo no encontrado, cuota, falta de red… Los nombres de modelo están al principio de `HybridLanguageModel.kt`.
- **Gemini Nano:** solo existe en móviles recientes con AICore (Pixel 9/10, Galaxy S25/S26 y similares). En los demás, todo va a la nube sin que tengas que hacer nada. La primera vez, el móvil puede tardar en descargar el modelo.
- **Voz:** usa el reconocedor del sistema. Para dictar sin conexión, descarga el paquete de voz en español (Ajustes → Google → Voz o el equivalente en Samsung). En Samsung, si el dictado falla, elige el reconocedor de Google como servicio de voz predeterminado.
- **Health Connect:** en Samsung Health, activa la sincronización con Health Connect (Samsung Health → Ajustes → Health Connect) y concede peso, calorías y pasos. Después, en la pestaña **Semana**, pulsa "Importar peso, gasto y pasos de Health Connect". Si no hay datos, la captura del reloj sigue funcionando desde el chat.
- **Mínimo de proteína:** sale de tu peso (1,5 g/kg). Hasta que registres un peso ("apunta 92,6 para el peso") o lo importes de Health Connect, no se muestra.
- **Datos:** se guardan en el móvil (`registro.json`) y, con cuenta, en Supabase. Sin cuenta, desinstalar la app los borra. La sincronización corre sola unos segundos después de cada cambio y al abrir la app. Sin red no pasa nada: se reintenta después. Si un mismo registro se cambia en dos móviles sin conexión, gana el último que sincroniza.
- **Primera vez con cuenta:** lo que ya tuvieras en el móvil se sube, y lo que hubiera en la cuenta (también tu historial de la web) se baja. Si en el móvil hay datos de otra cuenta, la app no los mezcla y te pide borrarlos primero (Ajustes → Borrar los datos de este móvil).
- **Open Food Facts:** tiene buena cobertura de Hacendado y otras marcas, pero no de todo, y su API limita a unas 10 búsquedas por minuto. Lo que encuentra se guarda en tu catálogo, así que cada producto se busca una sola vez. Si un producto no aparece, la foto de la etiqueta sigue siendo lo más fiable.
- **Tu catálogo:** empieza vacío. Para traer el de tus semanas de prueba, pásate `docs/datos/catalogo-inicial.md` al móvil (por Drive o por email) y en **Catálogo → Importar .md** elígelo: entran 52 alimentos con sus alias, sin pisar lo que ya tengas. Con cuenta, se suben solos.
- **Cuotas:** la capa gratuita de Gemini tiene límites diarios por proyecto. Para probar tú solo sobran; para publicar hace falta el plan de pago (ver el plan).
