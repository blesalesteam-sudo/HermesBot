// OpenBot: ajustes de los bots en WhatsApp y Telegram (conversaciones privadas). Todo en DATA_DIR/canales, solo
// legible por el dueño. Los tokens de los contactos propios de Telegram nunca vuelven a la app.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.ts";

export type Canal = "whatsapp" | "telegram";
export const CANALES: readonly Canal[] = ["whatsapp", "telegram"];

export interface Avisos {
  /** Un bot pide permiso o hace una pregunta en cualquier conversación. */
  permisos: boolean;
  /** Un bot termina un trabajo o una rutina en otra conversación. */
  terminadas: boolean;
  /** Una rutina o un trabajo falla. */
  fallos: boolean;
}

export interface Persona {
  id: string;
  nombre: string;
  /** La persona de OpenBot (su clave), para que sus mensajes lleven su nombre como en la app. */
  clave?: string;
  /** Número de WhatsApp, solo dígitos con prefijo de país. */
  whatsapp?: string;
  /** Id numérico de Telegram. */
  telegram?: string;
  /** Dónde escribirle por iniciativa del bot: el chat de WhatsApp («…@s.whatsapp.net» o «…@lid») y el de Telegram. */
  chat: Partial<Record<Canal, string>>;
  /** Con qué bot habla ahora por el número o contacto general. */
  botActivo: Partial<Record<Canal, string>>;
  avisos: Avisos;
  /** Por dónde le llegan los avisos de otras conversaciones. */
  avisosPor?: Canal;
}

export interface Conversacion {
  botId: string;
  persona: string;
  canal: Canal;
  /** Contacto de Telegram por el que va: el general o el propio del bot. */
  contacto: "general" | "propio";
}

export interface AjustesCanales {
  personas: Persona[];
  /** Qué bots se pueden usar desde fuera. */
  bots: Record<string, { whatsapp: boolean; telegram: boolean }>;
  /** Bots con su propio contacto de Telegram encendido (el token va aparte). */
  contactoPropio: Record<string, boolean>;
  /** Conversación de la app → a quién y por dónde. */
  conversaciones: Record<string, Conversacion>;
  /** La conversación en curso de cada persona, canal y bot: "persona|canal|bot" → threadId. */
  actuales: Record<string, string>;
}

export const AVISOS_POR_DEFECTO: Avisos = { permisos: true, terminadas: true, fallos: true };
const VACIO: AjustesCanales = { personas: [], bots: {}, contactoPropio: {}, conversaciones: {}, actuales: {} };

const ID = /^[\w-]{1,128}$/;

export function carpetaCanales(dataDir: string): string {
  const dir = join(dataDir, "canales");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const archivo = (dataDir: string) => join(carpetaCanales(dataDir), "ajustes.json");

function texto(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function persona(raw: Record<string, unknown>): Persona | null {
  const id = texto(raw.id, 64);
  const nombre = texto(raw.nombre, 60);
  if (!id || !ID.test(id) || !nombre) return null;
  const avisos = (raw.avisos ?? {}) as Partial<Avisos>;
  const chat = (raw.chat ?? {}) as Record<string, unknown>;
  const activo = (raw.botActivo ?? {}) as Record<string, unknown>;
  const whatsapp = texto(raw.whatsapp, 20)?.replace(/\D/g, "");
  const telegram = texto(raw.telegram, 20)?.replace(/\D/g, "");
  return {
    id, nombre,
    ...(texto(raw.clave, 200) ? { clave: texto(raw.clave, 200)! } : {}),
    ...(whatsapp ? { whatsapp } : {}),
    ...(telegram ? { telegram } : {}),
    chat: Object.fromEntries(CANALES.flatMap((c) => (texto(chat[c], 120) ? [[c, texto(chat[c], 120)!]] : []))),
    botActivo: Object.fromEntries(CANALES.flatMap((c) => (typeof activo[c] === "string" && ID.test(activo[c] as string) ? [[c, activo[c] as string]] : []))),
    avisos: {
      permisos: avisos.permisos !== false,
      terminadas: avisos.terminadas !== false,
      fallos: avisos.fallos !== false,
    },
    ...(raw.avisosPor === "whatsapp" || raw.avisosPor === "telegram" ? { avisosPor: raw.avisosPor } : {}),
  };
}

/** Lee el archivo sin fiarse de él: lo que no tenga la forma esperada se descarta. */
export function leerCanales(dataDir: string): AjustesCanales {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(archivo(dataDir), "utf8")) as Record<string, unknown>;
  } catch {
    return structuredClone(VACIO);
  }
  const personas = Array.isArray(raw.personas) ? (raw.personas as Record<string, unknown>[]).map(persona).filter((p): p is Persona => Boolean(p)).slice(0, 20) : [];
  const bots: AjustesCanales["bots"] = {};
  for (const [id, b] of Object.entries((raw.bots ?? {}) as Record<string, { whatsapp?: unknown; telegram?: unknown }>)) {
    if (ID.test(id) && b && typeof b === "object") bots[id] = { whatsapp: b.whatsapp === true, telegram: b.telegram === true };
  }
  const contactoPropio: AjustesCanales["contactoPropio"] = {};
  for (const [id, on] of Object.entries((raw.contactoPropio ?? {}) as Record<string, unknown>)) if (ID.test(id)) contactoPropio[id] = on === true;
  const conversaciones: AjustesCanales["conversaciones"] = {};
  for (const [hilo, c] of Object.entries((raw.conversaciones ?? {}) as Record<string, Record<string, unknown>>)) {
    if (!ID.test(hilo) || !c || typeof c !== "object") continue;
    if (typeof c.botId !== "string" || typeof c.persona !== "string" || (c.canal !== "whatsapp" && c.canal !== "telegram")) continue;
    conversaciones[hilo] = { botId: c.botId, persona: c.persona, canal: c.canal, contacto: c.contacto === "propio" ? "propio" : "general" };
  }
  const actuales: AjustesCanales["actuales"] = {};
  for (const [clave, hilo] of Object.entries((raw.actuales ?? {}) as Record<string, unknown>)) {
    if (typeof hilo === "string" && conversaciones[hilo]) actuales[clave] = hilo;
  }
  return { personas, bots, contactoPropio, conversaciones, actuales };
}

export function guardarCanales(dataDir: string, ajustes: AjustesCanales): void {
  writeFileAtomic(archivo(dataDir), JSON.stringify(ajustes, null, 2), { mode: 0o600 });
}

export const TOKEN_TELEGRAM = /^\d{5,20}:[A-Za-z0-9_-]{30,64}$/;
const archivoToken = (dataDir: string, botId: string) => join(carpetaCanales(dataDir), `telegram-${botId}.token`);

export function tokenPropio(dataDir: string, botId: string): string | null {
  if (!ID.test(botId)) return null;
  try {
    return readFileSync(archivoToken(dataDir, botId), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function guardarTokenPropio(dataDir: string, botId: string, token: string | null): void {
  if (!ID.test(botId)) return;
  const path = archivoToken(dataDir, botId);
  if (!token) {
    if (existsSync(path)) rmSync(path, { force: true });
    return;
  }
  writeFileAtomic(path, token, { mode: 0o600 });
}
