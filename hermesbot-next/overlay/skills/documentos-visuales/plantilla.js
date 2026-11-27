/* Motor de plantillas de OpenBot. Lee la descripción de la plantilla (JSON en <script id="datos">) y la dibuja en
   <main id="plantilla"> con las piezas del kit: cifras, progreso, lista con casillas, tablero, cuadrícula, tabla y notas.
   Lo que la persona cambia a mano se guarda en la página y se le cuenta al bot; cuando el bot reescribe la plantilla,
   sus cambios y los de la persona se combinan campo a campo, sin pisarse. */
(function () {
  "use strict";
  var root = document.getElementById("plantilla") || document.querySelector("main");
  var source = document.getElementById("datos");
  if (!root || !source) return;

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    for (var key in attrs || {}) {
      var value = attrs[key];
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "html") node.innerHTML = value;
      else if (key.slice(0, 2) === "on") node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    (children || []).forEach(function (child) { if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child); });
    return node;
  }
  function stable(value) {
    if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
    if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(function (k) { return JSON.stringify(k) + ":" + stable(value[k]); }).join(",") + "}";
    return JSON.stringify(value === undefined ? null : value);
  }
  function same(a, b) { return stable(a) === stable(b); }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function blank(value) { return value === undefined || value === null || value === ""; }

  var spec;
  try { spec = JSON.parse(source.textContent || "{}"); } catch (error) {
    root.innerHTML = '<div class="callout"><b>Esta plantilla no se puede leer</b>Hay un error en sus datos: ' + esc(error && error.message) + "</div>";
    return;
  }

  /* Lo que la página guarda para sí. Sin permiso para guardar (página publicada, o mostrada sin "state"), todo
     funciona igual pero los cambios duran lo que dure abierta. */
  var host = window.mausbot || window.openbot || null;
  var store = host && host.state ? host.state : null;
  function load(key) {
    if (!store) return Promise.resolve(undefined);
    return store.get(key).catch(function () { store = null; return undefined; });
  }
  function save(key, value) { if (store) store.set(key, value).catch(function () {}); }

  function withIds(rows, prefix) {
    return (Array.isArray(rows) ? rows : []).map(function (row, index) {
      var next = row && typeof row === "object" ? copy(row) : { texto: String(row) };
      if (blank(next.id)) next.id = prefix + (index + 1);
      next.id = String(next.id);
      return next;
    });
  }
  function byId(rows) { var map = {}; rows.forEach(function (row) { map[row.id] = row; }); return map; }

  /* Combina tres versiones de una colección: la que el bot escribió antes (base), la de la persona (mine) y la nueva
     del bot (theirs). En cada campo gana el bot solo si lo cambió; si no, se queda lo de la persona. */
  function merge(base, mine, theirs) {
    var b = byId(base), m = byId(mine), t = byId(theirs), out = [];
    theirs.forEach(function (row) {
      var was = b[row.id], now = m[row.id];
      if (!was) { out.push(row); return; }
      if (!now) { if (!same(row, was)) out.push(row); return; }
      var merged = {}, keys = {};
      [row, was, now].forEach(function (one) { Object.keys(one).forEach(function (k) { keys[k] = true; }); });
      Object.keys(keys).forEach(function (k) {
        var value = same(row[k], was[k]) ? now[k] : row[k];
        if (value !== undefined) merged[k] = value;
      });
      out.push(merged);
    });
    mine.forEach(function (row) { if (!t[row.id] && !b[row.id]) out.push(row); });
    // Copias: lo que la persona cambie después no debe tocar la versión del bot con la que se compara.
    return copy(out);
  }

  var collections = {};
  var notes = {};
  var ui = {};
  var refocus = null;
  var blocks = Array.isArray(spec.bloques) ? spec.bloques : [];
  var ids = Object.keys(spec.colecciones || {});
  var noteBlocks = blocks.filter(function (block) { return block && block.tipo === "notas"; });
  noteBlocks.forEach(function (block, index) { if (blank(block.id)) block.id = "notas" + (index + 1); });

  Promise.all(ids.map(function (id) {
    var given = spec.colecciones[id] || {};
    var theirs = withIds(given.filas, id.charAt(0) || "f");
    return Promise.all([load("b:" + id), load("r:" + id)]).then(function (kept) {
      var base = kept[0], mine = kept[1], rows;
      if (!Array.isArray(base) || !Array.isArray(mine)) rows = copy(theirs);
      else if (same(base, theirs)) rows = mine;
      else { rows = merge(base, mine, theirs); save("b:" + id, theirs); save("r:" + id, rows); }
      collections[id] = { id: id, name: given.nombre || "elemento", fields: Array.isArray(given.campos) ? given.campos : [], rows: rows, base: theirs, kept: Array.isArray(base) };
    });
  }).concat(noteBlocks.map(function (block) {
    var theirs = String(block.texto || "");
    return Promise.all([load("nb:" + block.id), load("n:" + block.id)]).then(function (kept) {
      var base = kept[0], mine = kept[1], text;
      if (typeof base !== "string" || typeof mine !== "string") text = theirs;
      else if (base === theirs) text = mine;
      else { text = theirs; save("nb:" + block.id, theirs); save("n:" + block.id, text); }
      notes[block.id] = { text: text, base: theirs };
    });
  }))).then(function () { render(); report(); watch(); });

  /* La misma plantilla puede estar abierta dos veces (la tarjeta del chat y la página): cada una recoge de vez en
     cuando lo que la otra haya guardado, salvo mientras la persona está tocando esta. */
  var touched = 0;
  function refresh() {
    if (!store || Date.now() - touched < 4000) return;
    var busy = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName || "") || (document.activeElement && document.activeElement.isContentEditable);
    if (busy) return;
    Promise.all(ids.map(function (id) { return load("r:" + id); }).concat(noteBlocks.map(function (block) { return load("n:" + block.id); }))).then(function (kept) {
      var moved = false;
      ids.forEach(function (id, index) {
        var rows = kept[index];
        if (Array.isArray(rows) && !same(rows, collections[id].rows)) { collections[id].rows = rows; collections[id].kept = true; moved = true; }
      });
      noteBlocks.forEach(function (block, index) {
        var text = kept[ids.length + index];
        if (typeof text === "string" && text !== notes[block.id].text) { notes[block.id].text = text; moved = true; }
      });
      if (moved && Date.now() - touched >= 4000) render();
    });
  }
  function watch() {
    if (!store) return;
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
    setInterval(refresh, 15000);
  }

  function changed(col) {
    touched = Date.now();
    if (!col.kept) { save("b:" + col.id, col.base); col.kept = true; }
    save("r:" + col.id, col.rows);
    render();
    report();
  }

  /* Le cuenta al bot, con el siguiente mensaje de la persona, qué ha cambiado ella a mano. */
  var reporting = null;
  function report() {
    if (!host || !host.setContext) return;
    clearTimeout(reporting);
    reporting = setTimeout(function () {
      var lines = [];
      ids.forEach(function (id) {
        var col = collections[id], b = byId(col.base), m = byId(col.rows);
        col.rows.forEach(function (row) {
          var was = b[row.id];
          if (!was) { lines.push("- " + id + ", fila nueva " + JSON.stringify(row)); return; }
          var diffs = [];
          Object.keys(row).concat(Object.keys(was)).forEach(function (k) {
            if (diffs.indexOf(k) < 0 && !same(row[k], was[k])) diffs.push(k);
          });
          if (diffs.length) lines.push("- " + id + " " + row.id + ": " + diffs.map(function (k) { return k + "=" + JSON.stringify(row[k] === undefined ? null : row[k]); }).join(", "));
        });
        col.base.forEach(function (row) { if (!m[row.id]) lines.push("- " + id + " " + row.id + ": borrada"); });
      });
      noteBlocks.forEach(function (block) {
        var note = notes[block.id];
        if (note && note.text !== note.base) lines.push("- notas " + block.id + ": " + JSON.stringify(note.text.slice(0, 600)));
      });
      var title = spec.titulo || document.title || "plantilla";
      var text = lines.length
        ? "«" + title + "»: cambios hechos a mano por la persona desde tu última versión. Ya están guardados en la página; si la reescribes, inclúyelos.\n" + lines.join("\n")
        : "";
      host.setContext(text.slice(0, 3800)).catch(function () {});
    }, 700);
  }

  /* ---- valores y aspecto ---- */
  function field(col, id) {
    for (var i = 0; i < col.fields.length; i++) if (col.fields[i].id === id) return col.fields[i];
    return { id: id, nombre: id, tipo: "texto" };
  }
  var TONES = ["azul", "verde", "ambar", "morado", "rojo", "gris"];
  var KNOWN = [[/^(alta|urgente|cr[ií]tic|bloquead|atrasad|perdid|cancelad)/i, "rojo"], [/^(media|en curso|en progreso|en marcha|pendiente de|revisi[oó]n|negociaci)/i, "ambar"],
    [/^(baja|sin |ninguna|archivad|en espera)/i, "gris"], [/^(hech|complet|termin|ganad|pagad|publicad|cerrad|ok|s[ií]$|activ)/i, "verde"], [/^(nuev|idea|por hacer|pendiente$|borrador|lead)/i, "azul"]];
  function tone(f, value) {
    if (blank(value)) return "gris";
    if (f.colores && f.colores[value]) return f.colores[value];
    for (var i = 0; i < KNOWN.length; i++) if (KNOWN[i][0].test(String(value))) return KNOWN[i][1];
    var index = (f.opciones || []).indexOf(value);
    return TONES[(index < 0 ? 0 : index) % TONES.length];
  }
  function money(value, f) {
    var number = Number(value) || 0;
    var options = { style: "currency", currency: f.moneda || "EUR", maximumFractionDigits: number % 1 ? 2 : 0, useGrouping: "always" };
    try { return new Intl.NumberFormat("es-ES", options).format(number); } catch (e) {
      try { options.useGrouping = true; return new Intl.NumberFormat("es-ES", options).format(number); } catch (e2) { return number + " €"; }
    }
  }
  function plain(value) {
    var number = Number(value) || 0;
    try { return new Intl.NumberFormat("es-ES", { useGrouping: "always", maximumFractionDigits: 2 }).format(number); } catch (e) { return number.toLocaleString("es-ES"); }
  }
  /* Lo que alguien escribe como número: "1.497,50", "1497,5", "1497.5" o "1.497". */
  function parseNumber(text) {
    var raw = String(text).replace(/[^\d,.\-]/g, "");
    if (raw.indexOf(",") >= 0) raw = raw.replace(/\./g, "").replace(",", ".");
    else if (!/^-?\d+\.\d{1,2}$/.test(raw)) raw = raw.replace(/\./g, "");
    var parsed = parseFloat(raw);
    return isNaN(parsed) ? "" : parsed;
  }
  function shortDate(value) {
    var parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
    if (!parts) return String(value || "");
    var date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    var options = { day: "numeric", month: "short" };
    if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
    return date.toLocaleDateString("es-ES", options).replace(".", "");
  }
  function overdue(value) {
    var parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
    if (!parts) return false;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])) < today;
  }
  function shown(f, value) {
    if (blank(value)) return "";
    if (f.tipo === "moneda") return money(value, f);
    if (f.tipo === "numero") return plain(value) + (f.unidad ? " " + f.unidad : "");
    if (f.tipo === "fecha") return shortDate(value);
    if (f.tipo === "casilla") return value ? "Sí" : "No";
    return String(value);
  }
  /* La suma de un campo en unas filas, escrita como ese campo (euros, o con su unidad). */
  function total(f, rows, col) {
    var sum = rows.reduce(function (acc, row) { return acc + (f.tipo === "cuenta" && col ? countOf(col, row, f).n : Number(row[f.id]) || 0); }, 0);
    return shown(f.tipo === "moneda" || f.tipo === "numero" ? f : { tipo: "numero" }, sum);
  }
  /* Un campo «cuenta» no se guarda: dice cuántas casillas de la fila están marcadas (los días cumplidos de un hábito). */
  function countOf(col, row, f) {
    var ids = Array.isArray(f.de) ? f.de : col.fields.filter(function (one) { return one.tipo === "casilla"; }).map(function (one) { return one.id; });
    return { n: ids.filter(function (id) { return Boolean(row[id]); }).length, of: ids.length };
  }
  function matches(row, where) {
    for (var key in where || {}) {
      var want = where[key], has = row[key];
      if (Array.isArray(want)) { if (want.indexOf(has) < 0) return false; }
      else if (typeof want === "boolean") { if (Boolean(has) !== want) return false; }
      else if (has !== want) return false;
    }
    return true;
  }
  function doneField(col, block) {
    if (block && block.casilla) return block.casilla;
    for (var i = 0; i < col.fields.length; i++) if (col.fields[i].tipo === "casilla") return col.fields[i].id;
    return null;
  }
  function textField(col, block) {
    if (block && block.texto && typeof block.texto === "string" && field(col, block.texto).tipo) return block.texto;
    for (var i = 0; i < col.fields.length; i++) if (!col.fields[i].tipo || col.fields[i].tipo === "texto") return col.fields[i].id;
    return col.fields[0] ? col.fields[0].id : "texto";
  }
  /* Una fila terminada (casilla marcada, o en un estado final como «Publicado» o «Ganado») ya no va con retraso. */
  var CLOSED = /^(hech|complet|termin|finaliz|ganad|perdid|pagad|cobrad|publicad|cerrad|cancelad|archivad|entregad|descartad)/i;
  function closed(col, row) {
    var done = doneField(col);
    if (done && row[done]) return true;
    for (var i = 0; i < col.fields.length; i++) {
      var f = col.fields[i], value = row[f.id];
      if (f.tipo !== "opcion" || blank(value)) continue;
      if (Array.isArray(f.final) ? f.final.indexOf(value) >= 0 : CLOSED.test(String(value))) return true;
    }
    return false;
  }
  function newId() { return "u" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }

  /* ---- editores de un valor ---- */
  function setValue(col, row, id, value) {
    if (same(row[id], value)) return;
    if (blank(value) && typeof value !== "boolean") delete row[id]; else row[id] = value;
    changed(col);
  }
  function editor(col, row, f, compact) {
    var value = row[f.id];
    if (f.tipo === "casilla") return checkbox(col, row, f.id, f.nombre);
    if (f.tipo === "cuenta") {
      var count = countOf(col, row, f);
      return el("span", { class: "tp-chip tp-count" + (count.of && count.n === count.of ? " tp-verde" : ""), text: count.n + " de " + count.of });
    }
    if (f.tipo === "opcion") {
      var select = el("select", { class: "tp-chip tp-" + tone(f, value), "aria-label": f.nombre || f.id, onchange: function () { setValue(col, row, f.id, select.value); } },
        [el("option", { value: "", text: compact ? "—" : (f.nombre || "—") })].concat((f.opciones || []).map(function (option) {
          return el("option", { value: option, text: option, selected: option === value });
        })));
      if (!blank(value) && (f.opciones || []).indexOf(value) < 0) select.appendChild(el("option", { value: value, text: value, selected: true }));
      return select;
    }
    if (f.tipo === "fecha") {
      var late = f.vence !== false && !blank(value) && overdue(value) && !closed(col, row);
      var input = el("input", { type: "date", value: blank(value) ? "" : String(value).slice(0, 10), "aria-label": f.nombre || f.id, onchange: function () { setValue(col, row, f.id, input.value); } });
      return el("label", { class: "tp-chip tp-date" + (blank(value) ? " tp-empty" : late ? " tp-rojo" : "") }, [el("span", { text: blank(value) ? (f.nombre || "Fecha") : shortDate(value) }), input]);
    }
    if (f.tipo === "numero" || f.tipo === "moneda") {
      var number = el("input", { class: compact === "cell" ? "tp-num" : "tp-chip tp-numchip", inputmode: "decimal", value: blank(value) ? "" : shown(f, value),
        placeholder: compact === "cell" ? (f.tipo === "moneda" ? "0 €" : "0") : (f.nombre || "0"), "aria-label": f.nombre || f.id,
        onfocus: function () { number.value = blank(row[f.id]) ? "" : String(row[f.id]).replace(".", ","); number.size = Math.max(4, number.value.length + 1); number.select(); },
        onblur: function () {
          var next = parseNumber(number.value);
          if (same(row[f.id], next) || (blank(row[f.id]) && next === "")) { number.value = blank(row[f.id]) ? "" : shown(f, row[f.id]); fit(); }
          else setValue(col, row, f.id, next);
        },
        onkeydown: function (event) { if (event.key === "Enter") number.blur(); } });
      var fit = function () { if (compact !== "cell") number.size = Math.max(3, (number.value || number.placeholder).length); };
      fit();
      return number;
    }
    var text = el("span", { class: "tp-text", contenteditable: "true", spellcheck: "false", "data-ph": f.nombre || "", text: blank(value) ? "" : String(value),
      onkeydown: function (event) { if (event.key === "Enter") { event.preventDefault(); text.blur(); } },
      onblur: function () { setValue(col, row, f.id, text.textContent.trim()); } });
    return text;
  }
  function checkbox(col, row, id, label) {
    return el("button", { type: "button", class: "tp-check", role: "checkbox", "aria-checked": row[id] ? "true" : "false", "aria-label": label || "Hecha",
      onclick: function () { setValue(col, row, id, !row[id]); } },
      [el("span", { html: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' })]);
  }
  function removeButton(col, row) {
    return el("button", { type: "button", class: "tp-x", "aria-label": "Borrar", title: "Borrar", onclick: function () {
      col.rows = col.rows.filter(function (one) { return one.id !== row.id; });
      changed(col);
    } }, ["×"]);
  }
  function adder(col, key, placeholder, defaults, textId) {
    var input = el("input", { class: "tp-add-input", placeholder: placeholder, "aria-label": placeholder, "data-add": key });
    return el("form", { class: "tp-add", onsubmit: function (event) {
      event.preventDefault();
      var value = input.value.trim();
      if (!value) return;
      var row = { id: newId() };
      row[textId] = value;
      for (var k in defaults || {}) if (!blank(defaults[k]) || typeof defaults[k] === "boolean") row[k] = defaults[k];
      col.rows.push(row);
      refocus = key;
      changed(col);
    } }, [el("span", { class: "tp-plus", "aria-hidden": "true", text: "+" }), input]);
  }

  /* ---- bloques ---- */
  function heading(block) { return block.titulo ? el("h2", { text: block.titulo }) : null; }

  function figures(block) {
    var col = collections[block.de];
    var items = (block.cifras || []).map(function (figure) {
      var value = figure.valor, f = null;
      if (col) {
        var rows = col.rows.filter(function (row) { return matches(row, figure.donde); });
        if (figure.suma) {
          f = field(col, figure.suma);
          value = total(f, rows, col);
        } else if (blank(value)) value = String(rows.length);
      }
      return el("div", { class: "kpi" }, [el("div", { class: "n", text: blank(value) ? "0" : String(value) }), el("div", { class: "l", text: figure.nombre || "" }), figure.detalle ? el("div", { class: "d", text: figure.detalle }) : null]);
    });
    return el("section", {}, [heading(block), el("div", { class: "kpis" }, items)]);
  }

  function progress(block) {
    var col = collections[block.de];
    if (!col) return null;
    var id = block.campo || doneField(col), total = col.rows.length;
    var done = col.rows.filter(function (row) { return Boolean(row[id]); }).length;
    var pct = total ? Math.round((done / total) * 100) : 0;
    return el("section", { class: "tp-progress" }, [
      el("div", { class: "tp-progress-head" }, [el("b", { text: block.titulo || "Avance" }), el("span", { text: done + " de " + total + " · " + pct + " %" })]),
      el("div", { class: "progress" }, [el("i", { style: "width:" + pct + "%" })]),
    ]);
  }

  function filterBar(col, block, key, done) {
    var state = ui[key];
    var groups = (block.filtros || []).map(function (id) {
      var f = field(col, id);
      var options = (f.opciones || []).slice();
      col.rows.forEach(function (row) { if (!blank(row[id]) && options.indexOf(row[id]) < 0) options.push(row[id]); });
      var pill = function (label, value) {
        var on = (state.filters[id] || "") === value;
        return el("button", { type: "button", class: "tp-pill" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", onclick: function () { state.filters[id] = value; render(); } }, [label]);
      };
      return el("div", { class: "tp-pills", role: "group", "aria-label": f.nombre || id }, [pill(f.nombre ? "Todo: " + f.nombre.toLowerCase() : "Todo", "")].concat(options.map(function (option) { return pill(option, option); })));
    });
    if (done && col.rows.some(function (row) { return row[done]; })) {
      groups.push(el("div", { class: "tp-pills" }, [el("button", { type: "button", class: "tp-pill" + (state.hideDone ? " on" : ""), "aria-pressed": state.hideDone ? "true" : "false",
        onclick: function () { state.hideDone = !state.hideDone; render(); } }, ["Ocultar hechas"])]));
    }
    return groups.length ? el("div", { class: "tp-bar" }, groups) : null;
  }
  function visible(col, key, done) {
    var state = ui[key];
    return col.rows.filter(function (row) {
      if (state.hideDone && done && row[done]) return false;
      for (var id in state.filters) if (state.filters[id] && row[id] !== state.filters[id]) return false;
      return true;
    });
  }

  function list(block, key) {
    var col = collections[block.de];
    if (!col) return null;
    var done = block.casilla === false ? null : doneField(col, block), textId = textField(col, block);
    var details = (block.detalles || []).map(function (id) { return field(col, id); });
    var rows = visible(col, key, done);
    var line = function (row) {
      return el("li", { class: "tp-row" + (done && row[done] ? " done" : "") }, [
        done ? checkbox(col, row, done) : el("span", { class: "tp-dot", "aria-hidden": "true" }),
        el("div", { class: "tp-main" }, [editor(col, row, field(col, textId))]),
        el("div", { class: "tp-meta" }, details.map(function (f) { return editor(col, row, f, true); })),
        removeButton(col, row),
      ]);
    };
    var body = [];
    if (block.agrupar) {
      var by = field(col, block.agrupar), names = (by.opciones || []).slice();
      rows.forEach(function (row) { var name = blank(row[by.id]) ? "" : row[by.id]; if (names.indexOf(name) < 0) names.push(name); });
      names.forEach(function (name) {
        var group = rows.filter(function (row) { return (blank(row[by.id]) ? "" : row[by.id]) === name; });
        if (!group.length) return;
        body.push(el("div", { class: "tp-group" }, [el("span", { text: name || "Sin " + (by.nombre || by.id).toLowerCase() }), el("i", { text: String(group.length) })]));
        body.push(el("ul", { class: "tp-list" }, group.map(line)));
      });
    } else if (rows.length) body.push(el("ul", { class: "tp-list" }, rows.map(line)));
    if (!rows.length) body.push(el("p", { class: "tp-none", text: col.rows.length ? "Nada con estos filtros." : "Todavía no hay nada. Añade lo primero aquí abajo." }));
    var defaults = {};
    for (var id in ui[key].filters) defaults[id] = ui[key].filters[id];
    if (done) defaults[done] = false;
    return el("section", {}, [heading(block), filterBar(col, block, key, done),
      el("div", { class: "tp-card" }, body.concat(block.anadir === false ? [] : [adder(col, key, "Añadir " + col.name + "…", defaults, textId)]))]);
  }

  function mover(col, row, by, names, current) {
    var select = el("select", { class: "tp-chip tp-empty tp-move", "aria-label": "Mover a otra columna", onchange: function () { setValue(col, row, by.id, select.value === "\u0000" ? "" : select.value); } },
      [el("option", { value: "", text: "Mover…", selected: true, disabled: true })].concat(names.filter(function (name) { return name !== current; }).map(function (name) {
        return el("option", { value: name === "" ? "\u0000" : name, text: name || "Sin " + (by.nombre || by.id).toLowerCase() });
      })));
    return select;
  }

  function card(col, row, textId, details, done, extra) {
    return el("div", { class: "tp-item" + (done && row[done] ? " done" : ""), draggable: "true", ondragstart: function (event) { event.dataTransfer.setData("text/plain", row.id); } }, [
      el("div", { class: "tp-item-top" }, [done ? checkbox(col, row, done) : null, el("div", { class: "tp-main" }, [editor(col, row, field(col, textId))]), removeButton(col, row)]),
      el("div", { class: "tp-meta" }, details.map(function (f) { return editor(col, row, f, true); }).concat(extra ? [extra] : [])),
    ]);
  }
  /* Los valores de un campo por los que se reparte una vista: sus opciones, lo que haya de más y, si hace falta, «sin». */
  function buckets(col, f, emptyFirst) {
    var names = (f.opciones || []).slice();
    col.rows.forEach(function (row) { if (!blank(row[f.id]) && names.indexOf(row[f.id]) < 0) names.push(row[f.id]); });
    if (col.rows.some(function (row) { return blank(row[f.id]); })) { if (emptyFirst) names.unshift(""); else names.push(""); }
    return names;
  }
  function bucketName(f, name) { return name || "Sin " + (f.nombre || f.id).toLowerCase(); }

  /* Cuadrícula: un campo reparte las columnas y otro las filas (los días y los bloques de una semana, por ejemplo). */
  function grid(block, key) {
    var col = collections[block.de];
    if (!col || !block.columnas) return null;
    if (!block.filas) return board(block, key);
    var across = field(col, block.columnas), down = field(col, block.filas), textId = textField(col, block), done = doneField(col, block);
    var details = (block.detalles || []).filter(function (id) { return id !== across.id && id !== down.id; }).map(function (id) { return field(col, id); });
    var xs = buckets(col, across), ys = buckets(col, down);
    var sumId = Array.isArray(block.suma) ? block.suma[0] : block.suma, sumField = sumId ? field(col, sumId) : null;
    var at = function (row, f) { return blank(row[f.id]) ? "" : row[f.id]; };
    var put = function (row, x, y) {
      if (at(row, across) === x && at(row, down) === y) return;
      if (x === "") delete row[across.id]; else row[across.id] = x;
      if (y === "") delete row[down.id]; else row[down.id] = y;
      changed(col);
    };
    var places = [];
    ys.forEach(function (y) { xs.forEach(function (x) { places.push([x, y]); }); });
    var move = function (row) {
      if (places.length > 42) return null;
      var select = el("select", { class: "tp-chip tp-empty tp-move", "aria-label": "Mover a otro hueco", onchange: function () { var to = places[Number(select.value)]; if (to) put(row, to[0], to[1]); } },
        [el("option", { value: "", text: "Mover…", selected: true, disabled: true })].concat(places.map(function (place, index) {
          if (place[0] === at(row, across) && place[1] === at(row, down)) return null;
          return el("option", { value: String(index), text: bucketName(across, place[0]) + " · " + bucketName(down, place[1]) });
        })));
      return select;
    };
    var cells = [el("div", { class: "tp-grid-corner" })].concat(xs.map(function (x) {
      var inColumn = col.rows.filter(function (row) { return at(row, across) === x; });
      return el("div", { class: "tp-grid-head" }, [el("span", { class: "tp-chip tp-" + tone(across, x), text: bucketName(across, x) }), el("i", { text: sumField ? total(sumField, inColumn, col) : String(inColumn.length) })]);
    }));
    ys.forEach(function (y) {
      cells.push(el("div", { class: "tp-grid-side" }, [el("span", { class: "tp-chip tp-" + tone(down, y), text: bucketName(down, y) })]));
      xs.forEach(function (x) {
        var defaults = {}; defaults[across.id] = x; defaults[down.id] = y; if (done) defaults[done] = false;
        var cell = el("div", { class: "tp-col tp-cell",
          ondragover: function (event) { event.preventDefault(); cell.classList.add("over"); },
          ondragleave: function () { cell.classList.remove("over"); },
          ondrop: function (event) {
            event.preventDefault();
            var moved = byId(col.rows)[event.dataTransfer.getData("text/plain")];
            cell.classList.remove("over");
            if (moved) put(moved, x, y);
          } }, col.rows.filter(function (row) { return at(row, across) === x && at(row, down) === y; }).map(function (row) {
            return card(col, row, textId, details, done, move(row));
          }).concat(block.anadir === false ? [] : [adder(col, key + ":" + x + "|" + y, "Añadir…", defaults, textId)]));
        cells.push(cell);
      });
    });
    return el("section", {}, [heading(block), el("div", { class: "wrapx" }, [
      el("div", { class: "tp-grid", style: "grid-template-columns:max-content repeat(" + xs.length + ",minmax(116px,1fr))" }, cells)])]);
  }

  function board(block, key) {
    var col = collections[block.de];
    if (!col || !block.columnas) return null;
    var by = field(col, block.columnas), textId = textField(col, block), done = doneField(col, block);
    var details = (block.detalles || []).filter(function (id) { return id !== by.id; }).map(function (id) { return field(col, id); });
    var names = buckets(col, by, true);
    var columns = names.map(function (name) {
      var cards = col.rows.filter(function (row) { return (blank(row[by.id]) ? "" : row[by.id]) === name; });
      var defaults = {}; defaults[by.id] = name; if (done) defaults[done] = false;
      var column = el("div", { class: "tp-col",
        ondragover: function (event) { event.preventDefault(); column.classList.add("over"); },
        ondragleave: function () { column.classList.remove("over"); },
        ondrop: function (event) {
          event.preventDefault();
          var moved = byId(col.rows)[event.dataTransfer.getData("text/plain")];
          column.classList.remove("over");
          if (moved) setValue(col, moved, by.id, name);
        } }, [
        el("div", { class: "tp-col-head" }, [el("span", { class: "tp-chip tp-" + tone(by, name), text: name || "Sin " + (by.nombre || by.id).toLowerCase() }), el("i", { text: String(cards.length) })]),
      ].concat(cards.map(function (row) {
        return card(col, row, textId, details, done, mover(col, row, by, names, name));
      })).concat(block.anadir === false ? [] : [adder(col, key + ":" + name, "Añadir…", defaults, textId)]));
      return column;
    });
    return el("section", {}, [heading(block), el("div", { class: "tp-board" }, columns)]);
  }

  function cellClass(f) { return f.tipo === "numero" || f.tipo === "moneda" ? "num" : f.tipo === "casilla" ? "chk" : ""; }
  function table(block, key) {
    var col = collections[block.de];
    if (!col) return null;
    var fields = (block.columnas && Array.isArray(block.columnas) ? block.columnas : col.fields.map(function (f) { return f.id; })).map(function (id) { return field(col, id); });
    var rows = visible(col, key, null);
    var sums = block.suma || [];
    var head = el("tr", {}, fields.map(function (f) { return el("th", { class: cellClass(f), text: f.nombre || f.id }); }).concat([el("th", { class: "tp-th-x" })]));
    var body = rows.map(function (row) {
      return el("tr", {}, fields.map(function (f) {
        return el("td", { class: cellClass(f) }, [editor(col, row, f, "cell")]);
      }).concat([el("td", { class: "tp-td-x" }, [removeButton(col, row)])]));
    });
    var foot = sums.length ? el("tr", { class: "tp-sum" }, fields.map(function (f, index) {
      if (sums.indexOf(f.id) < 0) return el("td", { text: index === 0 ? "Total" : "" });
      return el("td", { class: f.tipo === "cuenta" ? "" : "num", text: total(f, rows, col) });
    }).concat([el("td", {})])) : null;
    var first = fields[0] ? fields[0].id : "texto";
    return el("section", {}, [heading(block), filterBar(col, block, key, null),
      el("div", { class: "tp-card tp-card-table" }, [
        el("div", { class: "wrapx" }, [el("table", { class: "tp-table" }, [el("thead", {}, [head]), el("tbody", {}, body.concat(foot ? [foot] : []))])]),
        block.anadir === false ? null : adder(col, key, "Añadir " + col.name + "…", {}, first),
      ])]);
  }

  function notepad(block) {
    var note = notes[block.id];
    var area = el("textarea", { class: "tp-notes", rows: String(block.filas || 4), placeholder: block.ayuda || "Escribe aquí…", "aria-label": block.titulo || "Notas",
      onchange: function () { commit(); }, oninput: function () { clearTimeout(area._t); area._t = setTimeout(commit, 900); } });
    area.value = note.text;
    function commit() {
      if (area.value === note.text) return;
      if (typeof note.kept === "undefined") { save("nb:" + block.id, note.base); note.kept = true; }
      note.text = area.value;
      touched = Date.now();
      save("n:" + block.id, note.text);
      report();
    }
    return el("section", {}, [heading(block), area]);
  }

  function render() {
    var active = document.activeElement && document.activeElement.getAttribute ? document.activeElement.getAttribute("data-add") : null;
    var parts = [];
    if (spec.titulo || spec.resumen) parts.push(el("header", { class: "cover" }, [spec.titulo ? el("h1", { text: spec.titulo }) : null, spec.resumen ? el("p", { class: "lead", text: spec.resumen }) : null]));
    if (spec.aviso) parts.push(el("div", { class: "callout" }, [spec.aviso.titulo ? el("b", { text: spec.aviso.titulo }) : null, String(spec.aviso.texto || spec.aviso)]));
    var mainSeen = false;
    blocks.forEach(function (block, index) {
      if (!block || !block.tipo) return;
      var key = "b" + index;
      if (!ui[key]) ui[key] = { filters: {}, hideDone: Boolean(block.ocultarHechas) };
      var part = null;
      try {
        if (block.tipo === "cifras") part = figures(block);
        else if (block.tipo === "progreso") part = progress(block);
        else if (block.tipo === "lista") part = list(block, key);
        else if (block.tipo === "tablero") part = board(block, key);
        else if (block.tipo === "cuadricula") part = grid(block, key);
        else if (block.tipo === "tabla") part = table(block, key);
        else if (block.tipo === "notas") part = notepad(block);
        else if (block.tipo === "texto") part = el("section", {}, [heading(block), el("div", { html: String(block.html || "") })]);
      } catch (error) { part = el("div", { class: "callout" }, [el("b", { text: "Este bloque no se puede dibujar" }), String(error && error.message)]); }
      if (part && part.classList) {
        part.classList.add("tp-b", "tp-b-" + block.tipo);
        // La vista principal: en la tarjeta del chat es lo que se enseña, justo debajo del título y las cifras.
        if (!mainSeen && /^(lista|tablero|cuadricula|tabla)$/.test(block.tipo)) { mainSeen = true; part.classList.add("tp-main-view"); }
      }
      if (part) parts.push(part);
    });
    root.replaceChildren.apply(root, parts);
    var want = refocus || active;
    refocus = null;
    if (want) {
      var inputs = root.querySelectorAll("[data-add]");
      for (var i = 0; i < inputs.length; i++) if (inputs[i].getAttribute("data-add") === want) { inputs[i].focus(); break; }
    }
  }
})();
