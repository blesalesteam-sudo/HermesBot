---
name: documentos-visuales
description: "Criterio para elegir cómo se ve cada respuesta en el chat (texto, tarjeta, formulario, documento, panel o imagen) y kit de piezas para documentos con aspecto profesional. Está siempre disponible: aplícala con juicio en cada respuesta."
---

# Cómo se ve cada respuesta

Esta guía va contigo en todos los mensajes. No es una orden de hacer siempre algo visual: es criterio
para decidir, en cada respuesta, la forma que mejor sirve a la persona. Piensa como un buen asesor que
además sabe diseñar: primero qué necesita entender o decidir, después cómo se le enseña mejor.

La persona ve tus mensajes y las tarjetas que muestras, nunca tus herramientas. Un buen resultado se ve
como un producto terminado dentro del chat, no como un archivo que tiene que descargar y abrir.

## Decide la forma

Hazte estas preguntas, en orden, y quédate con la primera que encaje:

1. **¿Cabe en unas líneas?** Una respuesta, un dato, una confirmación, una conversación normal: texto.
   La mayoría de los mensajes son así. No conviertas una charla en una tarjeta.
2. **¿Tiene que elegir o confirmar algo?** Entre varias opciones, una hora, un día: una tarjeta con botones
   (`show_widget`). Una sola pregunta por tarjeta, como mucho seis opciones. Un sí o no se pregunta en el texto.
3. **¿Faltan datos o hay algo que rellenar o cambiar?** Un formulario (`show_widget`) ya rellenado con lo que sepas.
4. **¿Son unos pocos datos en filas y columnas?** Una tabla markdown en el mensaje.
5. **¿Merece leerse con calma o guardarse?** Un informe, un análisis, un plan, una estrategia, una comparativa,
   una propuesta, una investigación, el resumen de algo largo, o cuando te piden que lo presentes bien: un
   **documento** con `show_html` y el kit de abajo.
6. **¿Son cifras que se entienden mejor viéndolas?** Evolución, reparto, comparación de cantidades, KPIs:
   un **panel** con `show_html` (gráficos con echarts o Chart; para datos de su base, la habilidad `data-dashboards`).
7. **¿Es una imagen?** Adjúntala con `attach_file` (créala o edítala con `generate_image` / `edit_image` si hace falta).
   Nunca pegues una ruta ni un enlace suelto.

Reglas que no cambian:
- Si la persona pide algo visual ("enséñamelo", "preséntamelo", "ponlo bonito", "hazme un esquema"), enséñaselo
  visual aunque el contenido sea corto: una página breve bien hecha.
- Word, PDF, Excel o PowerPoint, solo si nombra ese formato. "Un documento" o "un informe" es una página en el chat.
  Si después quiere el archivo, se lo das además.
- Algo para que lo abran otras personas: la misma página con `publish_page`, avisando de que la abre cualquiera con el enlace.
- Si ya mostraste una página y te piden cambios, vuelve a llamar a `show_html` con su `app_id`: se actualiza la misma tarjeta.
  Si señalan una parte, cambia exactamente esa parte.

## Cómo es un buen documento

Antes de la tarjeta, escribe en el mensaje una o dos frases con lo esencial (la conclusión, no "aquí tienes").
Después muestra la página con `show_html` (`html` con el documento entero). No repitas en el mensaje lo que
ya está en la página.

Usa el kit de esta carpeta: copia `kit.css` dentro de un `<style>` y envuelve todo en `<main class="doc">`.
`ejemplo.html` es un documento completo hecho con el kit: úsalo como modelo de tono y densidad.
Se adapta solo a modo oscuro y a móvil. Usa solo las piezas que aporten:

- `h1` con un título concreto y un párrafo `.lead`: qué es, de dónde salen los datos y la fecha.
- Índice `.toc` con enlaces a cada `h2`, si hay cuatro secciones o más.
- Cifras clave: `.stats > .stat` (`.n` cifra, `.l` qué es, `.s` matiz), tres o cuatro.
- `.callout` "Lo esencial" con la conclusión en tres líneas, arriba; y si ayuda, otro al final ("La idea en una frase").
- Secciones `h2`, y dentro, lo que el contenido pida:
  - `.cols` con dos `.card`: a favor (`ul.pc.pro`) y en contra (`ul.pc.con`).
  - `.bars` para comparar cantidades (la mayor al 100 %, el resto en proporción).
  - `table` para comparar varias cosas con las mismas columnas; marca un dato malo con `class="red"`.
  - `dl.kv` como ficha de una persona, empresa o producto.
  - `ol.steps` para un plan o pasos en orden (cada `li` con `<b>` y `<span>`).
  - `.cols` con `.card` para oportunidades, opciones o huecos.

Contenido:
- Datos reales y su origen. Si algo es estimación o ejemplo, dilo.
- Cifras redondeadas y en las unidades de la persona (euros, su zona horaria).
- Frases cortas y concretas. Nada de relleno.
- Imágenes dentro de la página solo si cargan (tuyas o de una URL pública); si no, adjúntalas aparte.
