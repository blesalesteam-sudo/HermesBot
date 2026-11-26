---
name: documentos-visuales
description: "Cómo enseñar las cosas en el chat de forma muy visual: documentos e informes como página con índice, cifras y resumen; dashboards; tarjetas para elegir; formularios; imágenes. Úsala siempre que la respuesta sea más que unas líneas de texto: un informe, un análisis, un plan, una comparativa, una propuesta, un resumen de reunión, datos, una elección entre opciones o una imagen."
---

# Respuestas visuales

La persona ve tus mensajes y las tarjetas que muestras, nunca tus herramientas. Un buen resultado se
ve como un producto terminado dentro del chat, no como un archivo que tiene que descargar.

## Qué formato toca

| Lo que vas a entregar | Cómo se entrega |
|---|---|
| Una respuesta corta, un dato, un sí o no | Texto en el mensaje, sin tarjeta. |
| Elegir entre opciones, una hora, un día | `show_widget` con una tarjeta y botones (máximo seis). Una pregunta por tarjeta. |
| Datos que cambiar o rellenar | `show_widget` con un formulario ya rellenado con lo que sepas. |
| Tabla de datos sencilla | Tabla markdown en el mensaje. |
| Informe, análisis, plan, comparativa, propuesta, investigación, resumen largo | **Documento** con `show_html` y el kit de abajo. |
| Gráficos, KPIs, panel de datos | Dashboard con `show_html` (habilidad `data-dashboards`). |
| Algo para que lo abran otras personas | La misma página con `publish_page`; avisa de que la abre cualquiera con el enlace. |
| Una imagen que has hecho o encontrado | Adjúntala con `attach_file` (o `generate_image` / `edit_image` si hay que crearla). Nunca pegues una ruta. |
| Word, PDF, Excel o PowerPoint | Solo si la persona lo pide con esas palabras. Si no, es un documento en el chat. |

Nunca crees un `.docx` o `.pdf` porque te pidan "un documento", "un informe" o "algo bonito": eso es un
documento con `show_html`. Si después quieren el archivo, se lo das además.

## Cómo es un buen documento

Antes de la tarjeta, escribe en el mensaje una o dos frases con lo esencial (la conclusión, no un
"aquí tienes"). Después muestra la página con `show_html` (`html` con el documento entero). Para
cambiarla más tarde, vuelve a llamar a `show_html` con su `app_id`: la misma tarjeta se actualiza.

Estructura, en este orden y solo con las piezas que aporten:

1. `h1` con un título concreto y un párrafo `.lead` que diga qué es, de dónde salen los datos y la fecha.
2. Índice `.toc` con enlaces a cada `h2` (si hay cuatro secciones o más).
3. `h2` "La foto en 30 segundos" con 3 o 4 cifras `.stats > .stat` (`.n` cifra, `.l` qué es, `.s` matiz).
4. Un `.callout` "Lo esencial" con la conclusión en tres líneas.
5. Secciones `h2` con lo que toque:
   - `.cols` con dos `.card`: "A favor" (`ul.pc.pro`) y "En contra" (`ul.pc.con`).
   - `.bars` para comparar cantidades (la mayor al 100 %, las demás en proporción).
   - `table` para comparar varias cosas por las mismas columnas; marca un dato malo con `class="red"`.
   - `dl.kv` como ficha de una persona, empresa o producto.
   - `ol.steps` para un plan o pasos en orden (cada `li` con `<b>` y `<span>`).
   - `.cols` con `.card` para huecos, oportunidades u opciones.
6. Termina con un `.callout` "La idea en una frase" o con los siguientes pasos.

Copia el CSS de `kit.css` (en esta carpeta) dentro de un `<style>` y envuelve todo en `<main class="doc">`.
`ejemplo.html` es un documento completo hecho con el kit: úsalo como modelo. Se adapta solo a modo oscuro y a móvil.

Reglas de contenido:
- Datos reales y su origen. Si algo es una estimación o un ejemplo, dilo.
- Cifras redondeadas y en las unidades de la persona (euros, su zona horaria).
- Frases cortas. Nada de relleno ni de "espero que te sirva".
- Las imágenes van dentro de la página con `<img>` solo si son tuyas o de una URL pública que cargue; si no, adjúntalas aparte.

## Después de entregar

No repitas en el mensaje lo que ya está en la página. Como mucho, un siguiente paso concreto.
Si la persona señala una parte de la página, cambia exactamente esa parte con `show_html` y el mismo `app_id`.
