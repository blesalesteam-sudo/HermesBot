# hermesbot-next

El nuevo hermesBot. Parte de [OpenMausBot](https://github.com/milind-soni/OpenMausBot)
(licencia Apache-2.0) en una versión fijada, sin su carpeta de funciones de pago, y con
Hermes Agent en la misma máquina como motor de los bots.

Regla del proyecto: no se reescribe la base. Solo se quita y se añade, con parches
pequeños en `patches/` que se aplican al construir. Así se pueden recibir las mejoras
de la base cambiando una sola línea (`OMB_COMMIT` en el `Dockerfile`).

- `Dockerfile`: descarga la base, aplica los parches, la construye y la junta con Hermes.
- `start.sh`: arranque. Todo lo que se guarda vive en `/opt/data` (el volumen).
- `edge.mjs`: puerta de entrada. Lo que llega de internet tiene que identificarse.
- `patches/`: nuestros cambios sobre la base, en orden alfabético.

En Railway: servicio con esta carpeta como raíz, un volumen en `/opt/data` y un dominio
público. Para dar acceso al primer dispositivo: `hermesbot pair` dentro del servicio.

## Conectar Hermes a tu suscripción (una sola vez)

En el Mac, la app de OpenMausBot usa el Hermes del propio Mac (`~/.hermes`), con su sesión ya
iniciada. En Railway, Hermes vive en el volumen `/opt/data` y tiene su propia sesión: hay que
iniciarla una vez dentro del servicio. Nunca se copian claves ni `auth.json` a mano.

1. Abre una consola en el servicio: `railway ssh -s hermesbot-next`
2. Elige proveedor y modelo **como el usuario `hermes`** (si lo haces como root, la app no podrá
   leer los archivos):
   `runuser -u hermes -- env HOME=/opt/data HERMES_HOME=/opt/data hermes model`
   Elige tu suscripción (por ejemplo OpenAI Codex / ChatGPT) y sigue el código que te da para
   iniciar sesión en el navegador.
3. Comprueba: `runuser -u hermes -- env HOME=/opt/data HERMES_HOME=/opt/data hermes auth status`
4. En la app, crea o edita el bot con el modelo "Hermes default (config)": usa lo elegido en el paso 2.

## Varios usuarios (por ejemplo, dos socios)

Cada persona entra con su usuario y su contraseña. Todos trabajan con los mismos bots, cada mensaje
lleva quién lo escribió y los bots lo saben: en cada mensaje reciben una nota con el nombre de quien habla.

- **Primer administrador:** en Railway, pon las variables `OPENBOT_ADMIN_USER` y
  `OPENBOT_ADMIN_PASSWORD` (y si quieres `OPENBOT_ADMIN_NAME`). Al arrancar se crea esa cuenta si
  todavía no hay ninguna. Después puedes quitar la contraseña de las variables.
- **Más usuarios:** Ajustes → Personas → Usuarios. Ahí se crean, se cambia su contraseña, se hacen
  administradores o se borran. Siempre queda al menos un administrador.
- **Bots solo para algunos:** en los ajustes del bot, "Quién puede verlo" → "Solo estas personas",
  y escribe sus usuarios (uno por línea).
- Por dentro, cada usuario es la dirección `<usuario>@openbot.local`; nunca se envía correo a ella.

Archivos: `overlay/server/local-accounts.ts` (cuentas, contraseñas con scrypt),
`overlay/server/routes/local-accounts.ts` (entrar y gestionar), `overlay/src/components/LocalAccountsSection.tsx`
(Ajustes) y `patches/70-usuarios.patch` (conexión con la app, pantalla de entrada y visibilidad de bots).

## Respuestas visuales en el chat

Para que el bot enseñe las cosas como en Grok Bot (documentos con índice y cifras, dashboards,
tarjetas para elegir, formularios e imágenes adjuntas) en vez de crear archivos Word:

- `patches/0001-chat-visual.patch`: añade a las reglas de respuesta cuándo usar cada formato
  (Word, PDF, Excel o PowerPoint solo si se piden) y manda a Hermes un recordatorio corto en cada
  mensaje, porque las instrucciones de la app solo le llegan en el primero.
- `overlay/skills/documentos-visuales/`: habilidad con el kit de piezas (`kit.css`) y un
  documento de ejemplo (`ejemplo.html`). Va en todos los mensajes (su palabra clave es `*`,
  que el parche convierte en "siempre") y el bot decide con criterio cuándo usar texto,
  tarjeta, formulario, documento, panel o imagen.

- `patches/60-archivos-en-chat.patch`: si el bot escribe la ruta de un audio o vídeo en vez de
  adjuntarlo, sale igualmente con su reproductor debajo de la respuesta.
- `rebrand.mjs`: al construir, pone OpenBot en los textos que aún decían MausBot y llama "Hermes"
  al bot principal (respeta las frases sobre MausBot Cloud y los informes a sus autores).
- `start.sh`: la app arranca en español si no se ha elegido otro idioma en Ajustes.

- **Plantillas** (`patches/99-plantillas.patch`, `overlay/server/openbot-kit.ts`): una página puede enlazar el kit
  en vez de copiarlo (`<link rel="stylesheet" href="kit.css">`, `<script src="plantilla.js"></script>`); la app lo
  incrusta al mostrarla. `plantilla.js` es un motor de plantillas: el bot describe la plantilla en JSON (colecciones
  con campos y filas, y bloques: cifras, progreso, lista con casillas, tablero, tabla, notas) y el motor la dibuja,
  guarda lo que la persona cambia a mano (`mausbot.state`) y se lo cuenta al bot con su siguiente mensaje. Cuando
  el bot reescribe la plantilla, sus cambios y los de la persona se combinan campo a campo por el `id` de cada fila.
  Ejemplos en `overlay/skills/documentos-visuales/ejemplo-plantilla*.html`.

Para probarlo: en un chat con un bot de Hermes, pide "hazme un análisis de mis competidores" o
"¿qué opción me recomiendas, A o B?" y comprueba que llega una página o una tarjeta, no un archivo.

El nombre "OpenMausBot", "MausBot" y su mascota son marca de sus autores: este producto
usa nombre e imagen propios. Los avisos de licencia originales se conservan en `/app`.

## El logo

El logo es un primer plano del robot de antenas, blanco sobre negro, que llena el icono de borde a borde, con el mismo
tipo de volumen que el icono de Grok Bot (negro plano, blanco que se agrisa hacia abajo, ojos hundidos, filo blanco).
Lo dibuja `overlay/scripts/logo/gen-openbot-logo.mjs` (escribe `logo5-full.svg`, `logo5-square.svg` y `logo5-mac.svg`);
los PNG de `overlay/public/openbot-logo-*` y `favicon.ico` salen de esos SVG. Los nombres de archivo cambian con cada
logo nuevo para que navegadores y móviles no sigan enseñando el viejo.

## El aspecto de los bots

Los bots se crean con el mismo sistema que Grok Bot: eliges una forma de una cuadrícula de 5 columnas y un
color. Mismo estilo que Grok Bot: color plano, formas un poco giradas y solo dos ojos blancos inclinados,
sin boca. Los dibujos son propios de OpenBot. Solo el bot principal (Hermes) lleva las antenas del logo:
el archivo generado trae cada forma dos veces, sin antenas (`MASCOT_BODIES`) y con ellas
(`MASCOT_BODIES_WITH_ANTENNAS`), y `BotAvatar` usa la segunda cuando el bot tiene `defaultBot`.

- 27 formas (robot, mancha, guijarro, judía, huevo, cuadrado redondeado, tableta, cápsula, cilindro, hexágono,
  gema, cristal, cuña, escudo, cúpula, arco, nube, gota, hoja, cuadrado, destello, trébol, flor, corazón,
  casa, estrella y círculo). Salen de `overlay/scripts/gen-openbot-bodies.ts`, que escribe
  `overlay/packages/phone-protocol/src/mascot-bodies.ts` y comprueba que la cara cabe en cada forma. Para
  cambiar una forma: edita el script y ejecútalo dentro del código ya preparado
  (`node --experimental-strip-types scripts/gen-openbot-bodies.ts`), y copia el archivo resultante al overlay.
- 12 colores en el orden de Grok Bot: negro (negro de día, blanco de noche), marrón, rojo, naranja, amarillo,
  verde, turquesa, celeste, azul, violeta, magenta y gris. Se guardan con los nombres de siempre, así que los
  bots que ya existían conservan su color.
- Mientras Hermes piensa, busca o trabaja, las puntas de sus antenas se encienden y laten
  (`overlay/public/openbot-theme.css`).
- `patches/92-bots-estilo-grok.patch`: colores, todas las formas con el dibujo del robot (antes las formas usaban
  otro motor sin antenas), ojos blancos sin boca, el selector solo con formas y el estado del bot en el dibujo para encender las antenas.
  Los nombres en español los pone `rebrand.mjs`.

- Crear y editar un bot, como en Grok Bot: al pulsar "Bot nuevo" sale el panel "Crear nuevo Bot" (vista previa en
  grande, nombre, 13 formas y 11 colores; Cancelar / Crear). En el menú de cada bot, "Editar Bot" abre el mismo
  panel con su nombre, forma y color para cambiarlos. Panel: `overlay/src/components/BotLookDialog.tsx`;
  conexión con la app: `patches/94-panel-crear-bot.patch`; textos en `rebrand.mjs`.

## Grupos de Telegram y WhatsApp (oyente silencioso)

En **Ajustes → Funciones → Grupos de Telegram y WhatsApp**. Todo empieza apagado y sin conectar.

- El bot está en los grupos, lee lo que se habla y lo guarda: el registro completo en
  `/opt/data/.openmausbot/grupos/registro/` (un archivo por grupo y día) y, en la memoria de cada bot elegido,
  un tema por grupo (`memory/grupo ….md`) con las últimas semanas, para resúmenes, tareas, decisiones, fechas y enlaces.
- Cada grupo tiene su modo: **apagado** (no lee), **silencioso** (lee y guarda, nunca escribe) o **bajo demanda**
  (además contesta en el grupo solo a quien menciona al bot o responde a un mensaje suyo, con pausas y un tope diario).
  La respuesta la escribe el motor del bot elegido sin herramientas ni memoria privada, solo con lo hablado en el grupo.
- Lo que se dice en un grupo es información, no órdenes.
- **Telegram** (oficial, sin riesgo de bloqueo): un bot nuevo de @BotFather solo para OpenBot, con *Group Privacy* en
  *Turn off* (o administrador del grupo), y volver a meterlo en el grupo. El token se pone en Ajustes (se guarda en el
  volumen, nunca vuelve a la app) o en la variable `OPENBOT_TELEGRAM_TOKEN` de Railway, que gana.
  No uses el mismo bot en otro programa a la vez: Telegram solo deja un lector por bot.
- **WhatsApp** (no oficial, por código QR como WhatsApp Web): **puede bloquear el número**. Usa un número solo para el
  bot. La librería (Baileys) se instala aparte desde `whatsapp/` con versión fijada; la sesión vive en
  `/opt/data/.openmausbot/grupos/whatsapp-sesion/`. No marca mensajes como leídos ni aparece en línea.
- Código: `patches/90-grupos.patch` (archivos nuevos en `server/grupos/`, `server/routes/grupos.ts`,
  `src/components/settings/GruposSettings.tsx`, y dos líneas en `server/index.ts` y en la página Funciones).

## Traer los bots de Grok Bot

Grok Bot no tiene botón de exportar y guarda casi todo en su nube. En el Mac sí deja una copia de la lista de bots
(nombre, instrucciones, forma y color) y del chat de cada uno. La app en Railway no puede leer el Mac, así que hay
dos pasos:

1. En el Mac donde está Grok Bot: `node traslado-grok/exportar.mjs`. Solo lee (nunca cambia nada de Grok Bot ni
   abre claves o sesiones) y deja `openbot-traslado-grok-bot.json` en Descargas. Si algún bot de Grok Bot ha escrito
   su propia exportación (`grok-bot-export-*.json` en Descargas, con el mensaje de Ajustes → Importar → Grok Bot), la
   junta: así vienen también sus habilidades, rutinas, recuerdos y apps.
2. En OpenBot: Ajustes → Importar → Grok Bot → Elegir archivo → ese archivo → Importar.

Cada bot llega con su nombre, instrucciones, forma y color de Grok Bot, y su chat en un hilo "Chat from Grok Bot"
(solo como registro: no se responde a nada). Un bot que ya se trajo antes con el mismo nombre no se duplica: recibe
su chat y su aspecto. `patches/98-traslado-grok.patch`: lee la forma y el chat del archivo, crea los bots con ese
aspecto y añade la ruta `POST /api/setup-import/grok/chat` (solo el dueño) para subir el chat.

No se puede traer: las imágenes y archivos que los bots mandaron (viven en la nube de Grok Bot; en el chat queda
una línea "Envió el archivo …"), lo que Grok Bot guarda en su nube sin copia en el Mac (memoria, habilidades,
rutinas y apps, salvo que cada bot las escriba en su exportación), las claves y conexiones (hay que conectar las
apps otra vez), y el modelo de cada bot (Grok Bot no lo guarda en el Mac; aquí usan el motor de OpenBot). En el
bot "Investigación" Grok Bot solo guarda en el Mac sus últimos 200 mensajes.
