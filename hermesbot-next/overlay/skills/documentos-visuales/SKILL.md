---
name: documentos-visuales
description: "Criterio para elegir cómo se ve cada respuesta en el chat (texto, tarjeta, formulario, documento, panel, plantilla o imagen), kit de piezas para documentos y paneles con aspecto profesional, y motor de plantillas con las que la persona y tú trabajáis (tareas, seguimientos, tableros). Está siempre disponible: aplícala con juicio en cada respuesta."
---

# Cómo se ve cada respuesta

Esta guía va contigo en todos los mensajes. No es una orden de hacer siempre algo visual: es criterio
para decidir, en cada respuesta, la forma que mejor sirve a la persona. Piensa como un buen asesor que
además sabe diseñar: primero qué necesita entender o decidir, después cómo se le enseña mejor.

La persona ve tus mensajes y las tarjetas que muestras, nunca tus herramientas. Nunca nombres esta guía,
el kit ni las herramientas ("voy a aplicar la skill…", "uso show_html…"): di lo que vas a entregar.

## Decide la forma

Hazte estas preguntas, en orden, y quédate con la primera que encaje:

1. **¿Cabe en unas líneas?** Una respuesta, un dato, una confirmación, una conversación normal: texto.
   La mayoría de los mensajes son así. No conviertas una charla en una tarjeta.
2. **¿Tiene que elegir o confirmar algo?** Entre varias opciones, una hora, un día: una tarjeta (`show_widget`)
   con la pregunta como título y una fila de botones, uno por opción (se ven como una lista A, B, C). Cada botón
   lleva la opción completa en pocas palabras ("1.497 € o 3 cuotas de 529 €"), sin estilo primario. Una sola
   pregunta por tarjeta, como mucho seis opciones. Un sí o no se pregunta en el texto.
3. **¿Faltan datos o hay algo que rellenar o cambiar?** Un formulario (`show_widget`) ya rellenado con lo que
   sepas. El botón de enviar va **dentro** de la misma tarjeta, al final, nunca suelto debajo.
4. **¿Son unos pocos datos en filas y columnas?** Una tabla markdown en el mensaje.
5. **¿Merece leerse con calma o guardarse?** Un informe, un análisis, un plan, una estrategia, una comparativa,
   una propuesta, una investigación, el resumen de algo largo, o cuando te piden que lo presentes bien: un
   **documento** con `show_html` (ver "Documento").
6. **¿Son cifras que se entienden mejor viéndolas?** Evolución, reparto, comparación de cantidades, KPIs:
   un **panel** con `show_html` (ver "Panel"). Para datos de su base, además la habilidad `data-dashboards`.
7. **¿Es algo con lo que va a trabajar y que cambia con el tiempo?** Tareas, un seguimiento de clientes o de
   contenidos, hábitos, gastos, un tablero por estados, una lista de comprobación, o cuando pide "una plantilla" o
   "un sistema": una **plantilla** (ver "Plantillas").
8. **¿Es una imagen?** Créala o edítala con `generate_image` / `edit_image` en 16:9 (miniaturas, portadas,
   esquemas) o 1:1 (redes), nunca más ancha que 2:1, y adjúntala con `attach_file`. Nunca pegues una ruta ni un enlace suelto.

Reglas que no cambian:
- Si la persona pide algo visual ("enséñamelo", "preséntamelo", "ponlo bonito", "hazme un esquema"), enséñaselo
  visual aunque el contenido sea corto: una página breve bien hecha.
- Word, PDF, Excel o PowerPoint, solo si nombra ese formato. "Un documento" o "un informe" es una página en el chat.
  Si después quiere el archivo, se lo das además.
- Algo para que lo abran otras personas: la misma página con `publish_page`, avisando de que la abre cualquiera con el enlace.

## Una página por tema, que crece

- Si en esta conversación ya mostraste una página sobre el mismo tema y piden más (otra sección, otro
  competidor, una tabla nueva, un cambio), **amplía esa página**: vuelve a llamar a `show_html` con su `app_id`
  y el documento entero con lo nuevo añadido. No crees otra página. En el mensaje di qué has añadido.
- Crea una página nueva solo cuando el tema es otro.
- Si señalan una parte de la página, cambia exactamente esa parte, con el mismo `app_id`.

## El título y la portada (lo que se ve en el chat)

En el chat, cada página se ve como una tarjeta con una **vista previa** de su parte de arriba y, debajo, su
**título**. Lo primero de la página es lo que se ve en esa vista previa. Por eso:

- **`title`** es el nombre de la cosa, corto y concreto: "Competencia: análisis a fondo", "Ventas de noviembre".
  Nunca etiquetas ni tipos ("Documento visual ·", "Panel ·", "Demo ·", "Página de…").
- **Toda página empieza con una portada** (`<header class="cover">`), sobria, solo dos cosas:
  - `h1` con el mismo título.
  - `.lead`: una o dos frases con la conclusión, no una descripción ("Dos competidores te ganan en precio…").
- Justo después, lo más valioso: las cifras clave (`.stats` o `.kpis`) o el aviso `.callout` si hay algo que
  advertir (por ejemplo, que los datos son de ejemplo). Sin etiquetas, chips ni adornos encima del título.
- No pongas la tabla de contenidos antes de la portada.

## Documento

Antes de la tarjeta, escribe en el mensaje una o dos frases con lo esencial (la conclusión, no "aquí tienes").
Nombra la página en ese mensaje por su **título exacto** ("He añadido los riesgos a Plan de lanzamiento del curso"):
el título sale como enlace a la página. Haz lo mismo cada vez que la amplíes o vuelvas a hablar de ella.
Después muestra la página con `show_html` (`html` con el documento entero y `title`). No repitas en el mensaje
lo que ya está en la página.

Usa el kit de esta carpeta: pon `<link rel="stylesheet" href="kit.css">` en el `<head>` (la app lo incrusta sola al
mostrar la página; no lo copies ni lo pegues) y envuelve todo en `<main class="doc">`.
No cambies la tipografía (una sola letra sin remates para todo, también los titulares), los colores ni los tamaños,
y no añadas estilos propios salvo que la persona pida otro aspecto.
`ejemplo.html` es un documento completo hecho con el kit: úsalo como modelo de tono y densidad.
Se adapta solo a modo oscuro y a móvil. Después de la portada, solo las piezas que aporten:

- Índice `.toc` con enlaces a cada `h2`, si hay cuatro secciones o más.
- "La foto en 30 segundos": `.stats > .stat` (`.n` cifra, `.l` qué es, `.s` matiz), tres o cuatro.
- `.callout` "Lo esencial" con la conclusión en tres líneas; y si ayuda, otro al final ("La idea en una frase").
- Secciones `h2`, y dentro, lo que el contenido pida:
  - `.cols` con dos `.card`: a favor (`ul.pc.pro`) y en contra (`ul.pc.con`).
  - `.bars` para comparar cantidades en horizontal (la mayor al 100 %, el resto en proporción).
  - Un gráfico del apartado "Panel" cuando una evolución o un reparto se entiende mejor dibujado.
  - `table` para comparar varias cosas con las mismas columnas; marca un dato malo con `class="red"`.
  - `dl.kv` como ficha de una persona, empresa o producto.
  - `ol.steps` para un plan o pasos en orden (cada `li` con `<b>` y `<span>`).
  - `.cols` con `.card` para oportunidades, opciones o huecos.

## Panel

Un panel es para mirar cifras de un vistazo: tiene que llevar **al menos un gráfico de verdad**, no solo números.
`ejemplo-panel.html` es un panel completo: úsalo como modelo. Piezas del kit, sin librerías:

- `.kpis > .kpi` (`.l` etiqueta, `.n` cifra, `.d` variación con `.up` o `.down`).
- `.chart` con un `h4` y dentro:
  - `.vbars` (columnas `.col` con su valor y `<i style="height:…%">`; la más alta al 100 %, la importante `.hi`)
    más `.vlabels` debajo: comparar periodos o categorías.
  - `svg.spark` con `polyline` (y `polygon` para el relleno) en un `viewBox` de 300×100 y
    `preserveAspectRatio="none"`, para que ocupe todo el ancho: una evolución en el tiempo.
  - `.donut` con `conic-gradient` y `.legend`: un reparto (máximo 5 partes).
  - `.progress` para avanzar hacia un objetivo.
- Dos gráficos que se leen juntos van lado a lado: `.cols` con dos `.chart` dentro.
- Calcula las alturas y puntos a partir de los datos reales; no inventes formas.
- Si hacen falta gráficos interactivos o muchos datos, puedes usar echarts o Chart en `jsx`, con la misma portada.

## Plantillas

Una plantilla es una página viva con la que la persona y tú trabajáis: ella marca, escribe, añade y mueve cosas a
mano; tú la creas y la vas actualizando. No programes nada: describe la plantilla con datos y el motor la dibuja
con buen diseño, guarda lo que ella cambia y te lo cuenta.

La página es siempre esta, con tu descripción dentro. Hay dos completas para copiar como base:
`ejemplo-plantilla.html` (tareas: cifras, progreso, lista agrupada y notas), `ejemplo-plantilla-seguimiento.html`
(clientes por fases: tablero y tabla con totales), `ejemplo-plantilla-semana.html` (planificador de la semana:
cuadrícula de días por bloques, con horas) y `ejemplo-plantilla-habitos.html` (registro por días: una fila por
hábito, una casilla por día y la cuenta).

```html
<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Tareas de la semana</title>
<link rel="stylesheet" href="kit.css"></head><body>
<main class="doc" id="plantilla"></main>
<script type="application/json" id="datos">{ …la descripción… }</script>
<script src="plantilla.js"></script>
</body></html>
```

Muéstrala con `show_html` pasando la página en `html`, sin guardarla antes como archivo: es más rápido y no hace falta.

**La descripción** (JSON):

- `titulo` y `resumen` (una frase: para qué sirve y cómo se usa). `aviso` opcional: `{ "titulo", "texto" }`.
- `colecciones`: los datos. Cada una tiene `nombre` en singular ("tarea", "cliente"), `campos` y `filas`.
  - Un campo: `{ "id", "nombre", "tipo" }` con tipo `texto`, `casilla`, `opcion` (con `opciones`), `fecha`
    (`AAAA-MM-DD`), `numero` o `moneda`. En `opcion` puedes fijar `colores`: `{ "Alta": "rojo" }` (rojo, ambar,
    verde, azul, morado, gris); si no, se eligen solos. En `numero`, `unidad` (`"h"`, `"kg"`, `"%"`) la escribe
    detrás de cada valor y de cada suma: no la pongas en los nombres.
  - `cuenta`: no se rellena, se calcula: cuántas casillas de la fila están marcadas ("3 de 7"); con `"de": [...]`
    cuenta solo esas. Para un registro por días (hábitos, asistencia, rutinas) pon una fila por hábito y una
    `casilla` por día en una `tabla`, con un campo `cuenta` al final: no hagas una fila por cada día.
  - Una fecha pasada sale en rojo mientras la fila siga abierta. Se da por cerrada con la casilla marcada o en un
    estado final (Hecho, Publicado, Ganado, Perdido, Pagado, Cancelado…); si tus estados finales se llaman de otra
    forma, dilos en el campo: `"final": ["Emitida"]`. Si la fecha no es un plazo, ponle `"vence": false`.
  - Una fila: un objeto con un `id` corto y **estable** (`"t1"`, `"c7"`) y un valor por campo.
- `bloques`: lo que se ve, en orden. Cada bloque lleva `tipo`, casi siempre `de` (la colección) y `titulo`:
  - `cifras`: contadores que se calculan solos. `cifras: [{ "nombre": "Abiertas", "donde": { "hecho": false } }]`;
    con `"suma": "importe"` suma un campo en vez de contar.
  - `progreso`: barra con cuántas filas tienen marcada la casilla.
  - `lista`: filas con casilla para marcar. `detalles` (campos que salen como etiquetas a la derecha), `agrupar`
    (un campo `opcion`), `filtros` (campos `opcion` por los que filtrar), `ocultarHechas`.
  - `tablero`: columnas por los valores de un campo `opcion` (`"columnas": "estado"`); las tarjetas se arrastran.
  - `cuadricula`: un campo `opcion` reparte las columnas y otro las filas (`"columnas": "dia", "filas": "bloque"`):
    la semana por días y mañana/tarde, un menú por día y comida, una matriz urgente/importante. `detalles` como en
    la lista; con `"suma": "horas"` cada columna enseña su total. Es la vista para planificar; no uses una tabla
    para eso.
  - `tabla`: filas y columnas editables; `columnas` (campos a mostrar), `suma` (campos que se totalizan).
  - `notas`: un cuadro de texto libre que se guarda (`id`, `ayuda`).
  - `texto`: una sección tuya con `html` y las piezas del kit (para explicar, enlazar o añadir un gráfico).

**Cómo diseñarla.** Antes de construir, piensa qué decide o hace la persona con ella cada día y quédate con lo
justo: una colección por cada cosa distinta, pocos campos (los que de verdad va a mirar o filtrar), arriba las
cifras, después la vista principal y al final las notas. Si pide algo concreto ("con checklist, por prioridad y
con fecha"), eso manda. Si falta un dato para acertar (qué estados, qué áreas), pregúntalo con una tarjeta de
opciones; si no, elige lo razonable y dilo en una línea. Rellénala con sus datos reales si los tienes; si pones
ejemplos, avisa y que sean pocos.

**Cómo se ve en el chat.** La tarjeta enseña en pequeño el título, las cifras y la primera vista de la
plantilla (la primera `lista`, `tablero`, `cuadricula` o `tabla`), sin el resumen ni el aviso. Pon primero la vista
que mejor la represente: el tablero en un seguimiento por fases, la cuadrícula en un planificador, la lista en unas
tareas; la tabla para editar va después.

**Cómo se trabaja con ella.**

- Lo que la persona cambia a mano se guarda en la página. Con su siguiente mensaje te llega una nota ("cambios
  hechos a mano…") con lo que marcó, añadió, editó o borró: tenlo en cuenta al responder.
- Para cambiar tú algo (añadir tareas, marcar una hecha, reorganizar), vuelve a mostrar la página con su `app_id`
  y la descripción entera actualizada. Conserva los `id` de las filas: así lo tuyo y lo suyo se combinan sin
  pisarse (en cada dato gana quien lo cambió el último).
- Incluye en tu versión los cambios a mano que te hayan llegado, y no borres filas que ella añadió salvo que lo pida.
- Una plantilla por sistema: tareas en una, clientes en otra. Si pide una vista más (un tablero además de la
  lista), añade un bloque a la misma.
- En el mensaje, di en una frase qué tiene y cómo se usa, y nómbrala por su título exacto.

## Resumen en audio

Cuando entregues un documento o panel largo (cuatro secciones o más), manda además un resumen hablado con
`send_voice_note`: lo esencial en 3-5 frases, en su idioma, como se lo contarías en persona (como mucho 700
caracteres). Si la herramienta no está o falla, no lo menciones y sigue.

## Contenido

- En los mensajes del chat no pongas marcas de cita ni referencias sueltas: las fuentes van en la página, al final.
- Datos reales y su origen. Si algo es estimación o ejemplo, dilo.
- Cifras redondeadas y en las unidades de la persona (euros, su zona horaria).
- Frases cortas y concretas. Nada de relleno.
- Imágenes dentro de la página solo si cargan (tuyas o de una URL pública); si no, adjúntalas aparte.
