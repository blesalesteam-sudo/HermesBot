#!/usr/bin/env node
// Copiador de Grok Bot → OpenBot. Se ejecuta en el Mac donde está instalada la app Grok Bot:
//
//   node exportar.mjs
//
// Solo LEE. Nunca cambia, mueve ni borra nada de Grok Bot. Lee:
//   - La caché de la app (~/Library/Application Support/Grok Bot/sand-client-persistence): la lista de bots
//     (nombre, instrucciones, forma, color) y la copia local del chat de cada bot.
//   - Los archivos grok-bot-export-*.json que los propios bots hayan dejado en Descargas (habilidades, rutinas,
//     recuerdos y apps que solo el bot conoce, porque Grok Bot los guarda en su nube).
// No abre nunca sand-secrets.json, las cookies ni ~/.grokbot (claves y sesiones).
//
// Escribe en Descargas: openbot-traslado-grok-bot.json (o varias partes si es muy grande). Ese archivo se sube en
// OpenBot: Ajustes → Importar → Grok Bot → Elegir archivo.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const CACHE = ["Library/Application Support/Grok Bot", "AppData/Roaming/Grok Bot", ".config/Grok Bot"]
  .map((folder) => join(HOME, folder, "sand-client-persistence"))
  .find((folder) => { try { return statSync(folder).isDirectory(); } catch { return false; } });
const DOWNLOADS = join(HOME, "Downloads");
const OUT = (part, parts) => join(DOWNLOADS, parts > 1 ? `openbot-traslado-grok-bot-parte-${part}.json` : "openbot-traslado-grok-bot.json");
// Cada archivo cabe en el límite de la app (4 MB por archivo), con margen.
const MAX_FILE_CHARS = 3_500_000;

// ---- Nombres de Grok Bot → nombres de OpenBot ----
const SHAPES = ["blob", "pebble", "bean", "egg", "squircle", "tablet", "capsule", "cylinder", "hex", "gem", "crystal", "wedge",
  "shield", "dome", "arch", "cloud", "teardrop", "leaf", "square", "sparkle", "clover", "flower", "heart", "house", "star"];
const SHAPE_HERE = { hex: "hexagon", gem: "diamond", teardrop: "drop" };
const COLORS = ["black", "brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta", "gray"];
const COLOR_HERE = { black: "chrome", brown: "coral", cyan: "teal", violet: "purple", magenta: "pink", gray: "silver" };

// Cuando un bot no tiene forma o color elegidos, Grok Bot los saca de su id. Mismo cálculo, para que se vea igual.
const fnv = (text) => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const defaultShape = (id) => {
  let t = fnv(id) | 0;
  t = Math.imul(t ^ (t >>> 16), 73244475); t = Math.imul(t ^ (t >>> 13), 3266489909);
  const pool = ["blob", "pebble", "squircle", "tablet", "wedge", "hex", "cloud", "teardrop"];
  return pool[((t ^ (t >>> 16)) >>> 0) % pool.length] ?? "blob";
};
const defaultColor = (id) => {
  const pool = COLORS.filter((color) => color !== "black");
  let t = ((fnv(id) ^ Math.imul(1, 2654435769)) >>> 0 ^ Math.imul(1, 2654435769)) >>> 0;
  t = t + 1831565813 | 0;
  let n = Math.imul(t ^ (t >>> 15), 1 | t);
  n = n + Math.imul(n ^ (n >>> 7), 61 | n) ^ n;
  return pool[Math.floor((((n ^ (n >>> 14)) >>> 0) / 4294967296) * pool.length)] ?? "black";
};
const look = (row) => {
  const shape = SHAPES.includes(row.avatarShape) ? row.avatarShape : defaultShape(String(row.id));
  const color = COLORS.includes(row.avatarColor) ? row.avatarColor : defaultColor(String(row.id));
  return { shape: SHAPE_HERE[shape] ?? shape, color: COLOR_HERE[color] ?? color };
};

// ---- La caché de Grok Bot ----
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function sliceName(file) {
  if (!file.endsWith(".blob")) return null;
  const bytes = []; let bits = 0, value = 0;
  for (const ch of file.slice(0, -5).toUpperCase()) {
    const digit = B32.indexOf(ch); if (digit < 0) return null;
    value = ((value << 5) | digit) & 0xfff; bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 0xff); }
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)); } catch { return null; }
}
const PREFIX = "sand.client.slice.account.";
function slices() {
  const found = new Map();
  for (const file of readdirSync(CACHE)) {
    const id = sliceName(file);
    if (!id?.startsWith(PREFIX)) continue;
    const dot = id.indexOf(".", PREFIX.length);
    if (dot < 0) continue;
    const kind = id.slice(dot + 1);
    // Solo la lista de bots y los chats. Nada más.
    if (kind === "roster.last-roster" || kind.startsWith("transcript.replicas.")) found.set(kind, join(CACHE, file));
  }
  return found;
}
const readSlice = (path) => { try { return JSON.parse(readFileSync(path, "utf8"))?.value ?? null; } catch { return null; } };

// ---- El chat, como líneas de texto (lo mismo que la app ya sabe leer, más lo que faltaba) ----
const words = (value) => (typeof value === "string" ? value.trim() : "");
const rec = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const lines = (...parts) => parts.filter(Boolean).join("\n");
const SENT = {
  text: (m) => { const n = Array.isArray(m.images) ? m.images.length : 0; return lines(words(m.content), n === 1 ? "(Envió 1 imagen)" : n > 1 ? `(Envió ${n} imágenes)` : ""); },
  widget: (m, e) => {
    const w = rec(m.widget); const options = Array.isArray(w.options) ? w.options.map(rec) : [];
    const picked = options.find((o) => o.value === e.respondedValue)?.label ?? e.respondedValue;
    return lines(words(w.prompt), options.length ? `Opciones: ${options.map((o) => words(o.label)).filter(Boolean).join(", ")}` : "",
      words(picked) ? `Respuesta: ${words(picked)}` : e.widgetSkipped === true ? "(Saltado)" : "");
  },
  attachment: (m) => words(m.file_name) && `(Envió el archivo ${words(m.file_name)})`,
  "bot-template-share": (m) => words(m.name) && `(Compartió la plantilla de bot "${words(m.name)}")`,
  connector: (m) => words(m.connector) && `(Pidió conectar ${words(m.connector)})`,
  "cursor-agent": (m) => words(m.title) && `(Lanzó un agente de código: ${words(m.title)})`,
  "secret-request": (m) => words(rec(m.secretRequest).label) && `(Pidió un dato secreto: ${words(rec(m.secretRequest).label)})`,
};
function chatLine(e) {
  switch (words(e.kind)) {
    case "message": {
      if (e.role !== "user" && e.role !== "assistant") return null;
      const from = words(rec(e.fromAgent).name), to = words(rec(e.toAgent).name), text = words(e.content);
      return text ? { role: e.role === "user" ? "user" : "bot", text: from ? `${from}:\n${text}` : to ? `Para ${to}:\n${text}` : text } : null;
    }
    case "send-message": { const m = rec(e.message); const make = SENT[words(m.type)]; const text = make?.(m, e); return text ? { role: "bot", text } : null; }
    case "user-attachment": return words(e.file_name) ? { role: "user", text: `(Adjuntó ${words(e.file_name)})` } : null;
    case "mcp-app": return words(e.serverName) ? { role: "bot", text: `(Usó ${words(e.serverName)}${words(e.toolName) ? `: ${words(e.toolName)}` : ""})` } : null;
    case "event": { const ev = rec(e.event); return ev.type === "automation-changed" && words(ev.automationName) ? { role: "bot", text: `(Rutina "${words(ev.automationName)}" ${words(ev.action)})` } : null; }
    case "voice-call": {
      const turns = Array.isArray(rec(e.conversation).turns) ? rec(e.conversation).turns.map(rec) : [];
      const said = turns.map((t) => words(t.text) && `${t.speaker === "user" ? "Tú" : "Bot"}: ${words(t.text)}`).filter(Boolean);
      return { role: "bot", text: lines(`(Llamada de voz${words(rec(e.call).description) ? `: ${words(rec(e.call).description)}` : ""})`, ...said) };
    }
    default: return null;
  }
}
function chatOf(entries) {
  const ordered = (Array.isArray(entries) ? entries : []).map(rec)
    .filter((e) => Number.isSafeInteger(e.seq) && Number.isFinite(e.timestampMs)).sort((a, b) => a.seq - b.seq);
  const out = [];
  for (const [i, e] of ordered.entries()) {
    if (i > 0 && e.seq === ordered[i - 1].seq) continue;
    const line = chatLine(e);
    if (line?.text) out.push({ ...line, at: Math.floor(e.timestampMs) });
  }
  return out;
}

// ---- Lo que los bots escribieron de sí mismos (Descargas) ----
function botExports() {
  const bots = new Map();
  let files = [];
  try { files = readdirSync(DOWNLOADS).filter((name) => /^grok-bot-export[^/\\]*\.json$/i.test(name)); } catch { /* sin Descargas */ }
  for (const name of files.sort((a, b) => statSync(join(DOWNLOADS, a)).mtimeMs - statSync(join(DOWNLOADS, b)).mtimeMs)) {
    try {
      const doc = JSON.parse(readFileSync(join(DOWNLOADS, name), "utf8"));
      for (const bot of Array.isArray(doc?.bots) ? doc.bots : [doc]) {
        if (bot && typeof bot.name === "string") bots.set(bot.name.trim().toLowerCase(), { ...bots.get(bot.name.trim().toLowerCase()), ...bot });
      }
    } catch { console.log(`  (no se pudo leer ${name}; se deja fuera)`); }
  }
  return bots;
}

// ---- Juntarlo todo ----
if (!CACHE) {
  console.error("No encuentro la app Grok Bot en este ordenador.");
  process.exit(1);
}
const found = slices();
const roster = readSlice(found.get("roster.last-roster"));
const rows = (Array.isArray(roster?.rows) ? roster.rows : []).filter((row) => row && !row.isGroup && !row.isRemovedFromSidebar && typeof row.name === "string");
const written = botExports();
const bots = rows.map((row) => {
  const own = written.get(row.name.trim().toLowerCase()) ?? {};
  const chat = chatOf(readSlice(found.get(`transcript.replicas.${row.id}`) ?? "")?.entries);
  // En Grok Bot la "descripción" del bot son sus instrucciones; lo que el bot escriba de sí mismo manda si es más completo.
  const instructions = words(own.instructions).length > words(row.description).length ? words(own.instructions) : words(row.description);
  return {
    name: row.name.trim(),
    title: words(own.title) || words(row.title),
    description: "",
    instructions,
    memories: Array.isArray(own.memories) ? own.memories : [],
    user_facts: Array.isArray(own.user_facts) ? own.user_facts : [],
    skills: Array.isArray(own.skills) ? own.skills : [],
    routines: Array.isArray(own.routines) ? own.routines : [],
    apps: Array.isArray(own.apps) ? own.apps.map((app) => ({ name: app?.name ?? "", mcp_url: app?.mcp_url ?? "" })) : [],
    look: look(row),
    chat,
  };
});

// Partes: un bot con un chat muy largo se parte en trozos con el mismo nombre (la app los junta).
const docs = [];
let current = [];
const size = (list) => JSON.stringify({ format: "grok-bot-export", version: 1, bots: list }).length;
for (const bot of bots) {
  const pieces = [];
  let chat = bot.chat;
  while (size([{ ...bot, chat }]) > MAX_FILE_CHARS && chat.length > 1) {
    let cut = Math.floor(chat.length / 2);
    while (cut > 1 && size([{ ...bot, chat: chat.slice(0, cut) }]) > MAX_FILE_CHARS) cut = Math.floor(cut / 2);
    pieces.push({ ...bot, chat: chat.slice(0, cut) });
    chat = chat.slice(cut);
  }
  pieces.push({ ...bot, chat });
  for (const piece of pieces) {
    if (current.length && size([...current, piece]) > MAX_FILE_CHARS) { docs.push(current); current = []; }
    current.push(piece);
  }
}
if (current.length) docs.push(current);
docs.forEach((list, index) => writeFileSync(OUT(index + 1, docs.length), JSON.stringify({ format: "grok-bot-export", version: 1, bots: list }, null, 1)));

console.log(`Bots copiados de Grok Bot: ${bots.length}`);
for (const bot of bots) {
  const extra = [bot.skills.length && `${bot.skills.length} habilidades`, bot.routines.length && `${bot.routines.length} rutinas`, bot.memories.length && `${bot.memories.length} recuerdos`].filter(Boolean);
  console.log(`  - ${bot.name}: ${bot.chat.length} mensajes, forma ${bot.look.shape}, color ${bot.look.color}${extra.length ? `, ${extra.join(", ")}` : ""}`);
}
console.log(`\nGuardado en Descargas: ${docs.map((_, i) => OUT(i + 1, docs.length).split("/").pop()).join(", ")}`);
console.log("Súbelo en OpenBot: Ajustes → Importar → Grok Bot → Elegir archivo.");
