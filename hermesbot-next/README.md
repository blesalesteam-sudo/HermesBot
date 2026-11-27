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

Para probarlo: en un chat con un bot de Hermes, pide "hazme un análisis de mis competidores" o
"¿qué opción me recomiendas, A o B?" y comprueba que llega una página o una tarjeta, no un archivo.

El nombre "OpenMausBot", "MausBot" y su mascota son marca de sus autores: este producto
usa nombre e imagen propios. Los avisos de licencia originales se conservan en `/app`.

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
