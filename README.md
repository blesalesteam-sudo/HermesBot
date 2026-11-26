# hermesBot

El espacio de trabajo privado de dos socios con su equipo de bots. Los dos entran con su
usuario, ven el mismo chat en vivo y hablan con el mismo "cerebro": una instalación de
[Hermes Agent](https://github.com/NousResearch/hermes-agent) con su memoria y sus habilidades.

## Qué hace

- Acceso privado con usuario y contraseña. Los usuarios se crean y editan dentro de la app, en **Ajustes** (nombre, foto, contraseña y quién es administrador).
- Los bots también se crean y editan en Ajustes: nombre, color y cómo debe comportarse cada uno.
- Varios bots de fábrica (Hermes, Chief of Staff, Setter, Contenido y Operaciones) que comparten cerebro.
- Chat compartido en directo: ves cuándo escribe tu socio y qué está haciendo el bot.
- Cada mensaje lleva su autor, y Hermes sabe siempre quién le habla.
- Tarjetas de **Permitir / Denegar** cuando el bot quiere hacer algo delicado.
- Adjuntar fotos y archivos, dictar por voz, rutinas programadas, buscador y modo claro u oscuro.
- Corregir tu último mensaje o pedir otra respuesta: Hermes olvida la versión anterior.
- Avisos en el móvil o el ordenador aunque la app esté cerrada (Ajustes > Avisos y app).
- **WhatsApp** con código QR y **Telegram**, desde Ajustes > Aplicaciones.
- **Widgets**: un bot dentro de otra web (el CRM, canvas-ia) pegando una línea de código. Se crean en Ajustes > Widgets, con su llave y la lista de webs permitidas.
- **Capturador**: el bot escucha grupos de Telegram y guarda en Notion tareas, decisiones, enlaces y fechas cuando se le pide «captura» (Ajustes > Capturador).

## Cómo está montado

Son dos piezas que se despliegan en [Railway](https://railway.com) desde este mismo repositorio:

| Pieza | Carpeta | Para qué sirve |
|---|---|---|
| `hermes-core` | `hermes-core/` | Hermes Agent oficial con un disco que no se borra. Solo se habla con él por dentro, con una clave interna. |
| `hermesbot-web` | `web/` | La web que abren los socios. Guarda el historial y reparte todo en vivo. |

## Desplegar en Railway, paso a paso

1. En Railway, crea un proyecto nuevo con **Deploy from GitHub repo** y elige este repositorio.
2. Crea el servicio **hermes-core**:
   - En *Settings*, pon **Root Directory** en `hermes-core`.
   - En *Volumes*, añade un disco montado en `/opt/data`.
   - En *Variables*, pon solo `HERMES_INTERNAL_TOKEN`. El modelo de IA y su clave se eligen después dentro de la aplicación, en **Ajustes → Modelo de IA**.
   - En *Settings → Networking*, comprueba que el nombre interno es `hermes-core`. No le pongas dirección pública.
3. Crea el servicio **hermesbot-web** desde el mismo repositorio:
   - **Root Directory** en `web`.
   - Un disco montado en `/data`.
   - Las variables de la sección "hermesbot-web" de [`.env.example`](.env.example). `HERMES_INTERNAL_TOKEN` tiene que ser la misma que en hermes-core.
   - En *Settings → Networking*, pulsa **Generate Domain**. Esa es la dirección que abrirán los socios.
4. Abre la dirección. La primera vez te pide crear la cuenta de administrador y el **código de estreno**: es lo que pusiste en la variable `SETUP_CODE` de hermesbot-web (si no pusiste ninguno, aparece en los registros de ese servicio). Así nadie puede adelantarse a crear esa cuenta.
5. Dentro de la aplicación, en **Ajustes**: conecta el modelo de IA pegando su clave, añade al resto del equipo en *Usuarios* y revisa los *Bots*.

## Copias de seguridad

En **Ajustes → Copias** un administrador puede descargar una copia completa (cuentas, bots,
conversaciones, archivos y todo lo que Hermes ha aprendido) y restaurarla subiendo ese archivo.
Además, cada día se guarda una copia sola en el disco de hermesbot-web y se conservan las 7 últimas.
El archivo contiene vuestras claves: guárdalo en un sitio seguro.

Si el chat dice "Conectando con Hermes…" durante más de un minuto, revisa que la clave interna
coincide en los dos servicios y que `HERMES_CORE_URL` es `ws://hermes-core.railway.internal:8080/gateway`.

## Probar en tu ordenador

```bash
cd web
npm install
npm run build:demo   # vista previa con datos de prueba, sin Hermes
npm run dev          # la web en modo desarrollo (necesita el servidor: npm run dev:server)
```

## Detalles técnicos

- La web habla con Hermes por su protocolo oficial (`hermes-gateway-v1`, JSON-RPC por WebSocket)
  usando el cliente oficial, copiado en `web/server/vendor/hermes-shared` (licencia MIT).
- El gateway de Hermes solo acepta conexiones desde su propia máquina. Por eso `hermes-core`
  incluye un pequeño puente (`hermes-core/bridge`) que pide el pase a Hermes y solo deja entrar a
  quien presenta la clave interna.
- El diseño es propio. No usa logotipos ni recursos gráficos de terceros.
