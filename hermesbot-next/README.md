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

## Respuestas visuales en el chat

Para que el bot enseñe las cosas como en Grok Bot (documentos con índice y cifras, dashboards,
tarjetas para elegir, formularios e imágenes adjuntas) en vez de crear archivos Word:

- `patches/0001-chat-visual.patch`: añade a las reglas de respuesta cuándo usar cada formato
  (Word, PDF, Excel o PowerPoint solo si se piden) y manda a Hermes un recordatorio corto en cada
  mensaje, porque las instrucciones de la app solo le llegan en el primero.
- `overlay/skills/documentos-visuales/`: habilidad con el kit de piezas (`kit.css`) y un
  documento de ejemplo (`ejemplo.html`). Se activa sola cuando el mensaje habla de un informe,
  análisis, plan, comparativa, resumen o dashboard.

Para probarlo: en un chat con un bot de Hermes, pide "hazme un análisis de mis competidores" o
"¿qué opción me recomiendas, A o B?" y comprueba que llega una página o una tarjeta, no un archivo.

El nombre "OpenMausBot", "MausBot" y su mascota son marca de sus autores: este producto
usa nombre e imagen propios. Los avisos de licencia originales se conservan en `/app`.
