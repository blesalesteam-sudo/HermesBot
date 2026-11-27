// OpenBot: ajustes del oyente de grupos (Telegram y WhatsApp). Todo vive en DATA_DIR/grupos, con permisos solo del
// dueño. El token de Telegram nunca vuelve a la app: solo se dice si está puesto.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.ts";

export type Plataforma = "telegram" | "whatsapp";
/** apagado: no se lee ni se guarda nada. silencioso: se lee y se guarda, nunca se escribe en el grupo.
 * bajo-demanda: como silencioso, y además contesta cuando alguien menciona al bot o responde a un mensaje suyo. */
export type Modo = "apagado" | "silencioso" | "bajo-demanda";
export const MODOS: readonly Modo[] = ["apagado", "silencioso", "bajo-demanda"];

export interface Grupo {
  nombre: string;
  modo: Modo;
  /** El archivo de memoria de los bots, fijado la primera vez para que no cambie si el grupo cambia de nombre. */
  tema: string;
  vistoEn: number;
  ultimoMensaje?: number;
  mensajes: number;
}

export interface Ajustes {
  telegram: { activo: boolean };
  whatsapp: { activo: boolean };
  /** Qué hacer con un grupo nuevo en el que entra el bot. */
  gruposNuevos: "apagado" | "silencioso";
  /** Bots que reciben lo que se habla en su memoria; "todos" sigue a los bots que se creen después. */
  bots: "todos" | string[];
  /** El bot que escribe la respuesta en modo bajo demanda. */
  botQueResponde?: string;
  /** clave: "telegram:<id>" o "whatsapp:<jid>" */
  grupos: Record<string, Grupo>;
}

export const POR_DEFECTO: Ajustes = { telegram: { activo: false }, whatsapp: { activo: false }, gruposNuevos: "apagado", bots: "todos", grupos: {} };

export function carpetaGrupos(dataDir: string): string {
  const dir = join(dataDir, "grupos");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const archivo = (dataDir: string) => join(carpetaGrupos(dataDir), "ajustes.json");
const archivoToken = (dataDir: string) => join(carpetaGrupos(dataDir), "telegram-token");

function modo(value: unknown, fallback: Modo): Modo {
  return MODOS.includes(value as Modo) ? (value as Modo) : fallback;
}

/** Lee el archivo sin fiarse de él: lo que no tenga la forma esperada vuelve al valor por defecto. */
export function leerAjustes(dataDir: string): Ajustes {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(readFileSync(archivo(dataDir), "utf8")) as Record<string, unknown>;
  } catch {
    return structuredClone(POR_DEFECTO);
  }
  const grupos: Record<string, Grupo> = {};
  const crudos = raw.grupos && typeof raw.grupos === "object" ? raw.grupos as Record<string, Record<string, unknown>> : {};
  for (const [clave, g] of Object.entries(crudos)) {
    if (!/^(telegram|whatsapp):[\w@.:-]{1,120}$/.test(clave) || !g || typeof g !== "object") continue;
    grupos[clave] = {
      nombre: typeof g.nombre === "string" ? g.nombre.slice(0, 200) : clave,
      modo: modo(g.modo, "apagado"),
      tema: typeof g.tema === "string" && /^grupo [\p{L}\p{N} _-]{1,90}\.md$/u.test(g.tema) ? g.tema : nombreTema(clave, typeof g.nombre === "string" ? g.nombre : ""),
      vistoEn: typeof g.vistoEn === "number" ? g.vistoEn : Date.now(),
      ...(typeof g.ultimoMensaje === "number" ? { ultimoMensaje: g.ultimoMensaje } : {}),
      mensajes: typeof g.mensajes === "number" ? g.mensajes : 0,
    };
  }
  const bots = raw.bots === "todos" || !Array.isArray(raw.bots) ? "todos" : (raw.bots as unknown[]).filter((id): id is string => typeof id === "string" && /^[\w-]{1,128}$/.test(id));
  return {
    telegram: { activo: (raw.telegram as { activo?: unknown } | undefined)?.activo === true },
    whatsapp: { activo: (raw.whatsapp as { activo?: unknown } | undefined)?.activo === true },
    gruposNuevos: raw.gruposNuevos === "silencioso" ? "silencioso" : "apagado",
    bots,
    ...(typeof raw.botQueResponde === "string" && /^[\w-]{1,128}$/.test(raw.botQueResponde) ? { botQueResponde: raw.botQueResponde } : {}),
    grupos,
  };
}

export function guardarAjustes(dataDir: string, ajustes: Ajustes): void {
  writeFileAtomic(archivo(dataDir), JSON.stringify(ajustes, null, 2), { mode: 0o600 });
}

/** La variable de entorno gana: así se puede poner en Railway sin pasar por la app. */
export function tokenTelegram(dataDir: string): { token: string | null; deEntorno: boolean } {
  const env = process.env.OPENBOT_TELEGRAM_TOKEN?.trim();
  if (env) return { token: env, deEntorno: true };
  try {
    const token = readFileSync(archivoToken(dataDir), "utf8").trim();
    return { token: token || null, deEntorno: false };
  } catch {
    return { token: null, deEntorno: false };
  }
}

export const TOKEN_TELEGRAM = /^\d{5,20}:[A-Za-z0-9_-]{30,64}$/;

export function guardarTokenTelegram(dataDir: string, token: string | null): void {
  const path = archivoToken(dataDir);
  if (!token) {
    if (existsSync(path)) rmSync(path, { force: true });
    return;
  }
  writeFileAtomic(path, token, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** "grupo telegram socios 1234.md": legible en el índice de temas y único por el final del id. */
export function nombreTema(clave: string, nombre: string): string {
  const [plataforma, id = ""] = clave.split(":");
  const legible = nombre.normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 50).trim();
  const final = id.replace(/[^\p{N}A-Za-z]/gu, "").slice(-6);
  return `grupo ${plataforma} ${legible ? `${legible} ` : ""}${final}.md`.replace(/ +/g, " ");
}
