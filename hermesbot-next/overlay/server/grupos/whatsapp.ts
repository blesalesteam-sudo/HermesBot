// OpenBot: conector de WhatsApp con Baileys (vincular por código QR, como WhatsApp Web).
// Es una vía NO oficial: WhatsApp puede restringir o bloquear el número. Usa un número solo para el bot, nunca el tuyo.
// La librería se instala aparte de la base al construir (hermesbot-next/whatsapp) y se carga de OPENBOT_WHATSAPP_LIB;
// sin ella este conector dice que no está disponible y no hace nada más.
// Para no delatarse ni molestar: no marca nada como leído, no aparece "en línea" y no descarga el historial antiguo.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MAX_RESPUESTA, trocear, type Adjunto, type ArchivoSaliente, type Conector, type Entrante, type EstadoConector } from "./conector.ts";

/** Lo que se descarga de un chat privado para dárselo al bot. */
const MAX_DESCARGA = 25 * 1024 * 1024;

export interface WhatsappDeps {
  sesionDir: string;
  alRecibir: (m: Entrante) => void;
  alVerGrupo: (chatId: string, nombre: string) => void;
  /** Se cerró la sesión desde el teléfono o se desvinculó: el ajuste se apaga. */
  alDesvincular: () => void;
  log?: (line: string) => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Baileys = any;

async function cargarBaileys(): Promise<{ baileys: Baileys; pino: any } | null> {
  const dir = process.env.OPENBOT_WHATSAPP_LIB?.trim();
  if (!dir) return null;
  const entrada = (paquete: string, porDefecto: string) => {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, paquete, "package.json"), "utf8")) as { main?: string };
      return pathToFileURL(join(dir, paquete, pkg.main || porDefecto)).href;
    } catch {
      return null;
    }
  };
  const b = entrada("@whiskeysockets/baileys", "lib/index.js"), p = entrada("pino", "pino.js");
  if (!b || !p) return null;
  const [baileys, pino] = await Promise.all([import(b), import(p)]);
  return { baileys, pino: pino.default ?? pino };
}

function desenvolver(message: any): any {
  let m = message;
  for (let i = 0; i < 4 && m; i++) {
    const dentro = m.ephemeralMessage?.message ?? m.viewOnceMessage?.message ?? m.viewOnceMessageV2?.message ?? m.documentWithCaptionMessage?.message ?? m.editedMessage?.message?.protocolMessage?.editedMessage;
    if (!dentro) break;
    m = dentro;
  }
  return m;
}

function textoDe(m: any): string {
  if (!m) return "";
  const caption = m.imageMessage?.caption ?? m.videoMessage?.caption ?? m.documentMessage?.caption ?? "";
  const base = m.conversation ?? m.extendedTextMessage?.text ?? caption;
  const extra = m.imageMessage ? "[foto]" : m.videoMessage ? "[vídeo]" : m.audioMessage ? (m.audioMessage.ptt ? "[nota de voz]" : "[audio]")
    : m.documentMessage ? `[archivo: ${m.documentMessage.fileName ?? "sin nombre"}]` : m.stickerMessage ? "[sticker]" : m.locationMessage ? "[ubicación]"
    : m.contactMessage ? "[contacto]" : m.pollCreationMessage || m.pollCreationMessageV3 ? `[encuesta: ${(m.pollCreationMessage ?? m.pollCreationMessageV3).name ?? ""}]` : "";
  return [extra, base].filter(Boolean).join(" ").trim();
}

function contexto(m: any): any {
  if (!m) return null;
  for (const v of Object.values(m)) if (v && typeof v === "object" && "contextInfo" in (v as object)) return (v as { contextInfo?: unknown }).contextInfo;
  return null;
}

export type ConectorWhatsapp = Conector & { desvincular(): Promise<void>; vinculado(): boolean; numero(): string | null };

/** Las piezas de un mensaje privado que se descargan: foto, documento, nota de voz o audio, vídeo. */
function piezasDe(m: any): Array<{ tipo: Adjunto["tipo"]; mime: string; nombre: string; bytes?: number }> {
  const piezas: Array<{ tipo: Adjunto["tipo"]; mime: string; nombre: string; bytes?: number }> = [];
  if (m?.imageMessage) piezas.push({ tipo: "imagen", mime: m.imageMessage.mimetype ?? "image/jpeg", nombre: "foto.jpg", bytes: Number(m.imageMessage.fileLength) || undefined });
  if (m?.documentMessage) {
    const mime = m.documentMessage.mimetype ?? "application/octet-stream";
    piezas.push({ tipo: mime.startsWith("image/") ? "imagen" : "archivo", mime, nombre: m.documentMessage.fileName ?? "archivo", bytes: Number(m.documentMessage.fileLength) || undefined });
  }
  if (m?.audioMessage) piezas.push({ tipo: "audio", mime: m.audioMessage.mimetype ?? "audio/ogg", nombre: m.audioMessage.ptt ? "nota-de-voz.ogg" : "audio.ogg", bytes: Number(m.audioMessage.fileLength) || undefined });
  if (m?.videoMessage) piezas.push({ tipo: "archivo", mime: m.videoMessage.mimetype ?? "video/mp4", nombre: "video.mp4", bytes: Number(m.videoMessage.fileLength) || undefined });
  return piezas;
}

export function crearWhatsapp(deps: WhatsappDeps): ConectorWhatsapp {
  let estado: EstadoConector = { estado: "apagado" };
  let sock: Baileys = null;
  let vivo = false;
  let reintento: ReturnType<typeof setTimeout> | null = null;
  let qrs = 0;
  const nombres = new Map<string, string>();
  const recientes = new Map<string, any>();
  let baileysCargado: Baileys = null;
  let silencioso: any = null;

  const vinculado = () => {
    try {
      return Boolean(JSON.parse(readFileSync(join(deps.sesionDir, "creds.json"), "utf8"))?.me?.id);
    } catch {
      return false;
    }
  };

  async function nombreGrupo(jid: string): Promise<string> {
    const visto = nombres.get(jid);
    if (visto) return visto;
    try {
      const meta = await sock?.groupMetadata(jid);
      const nombre = String(meta?.subject || "Grupo sin nombre");
      nombres.set(jid, nombre);
      deps.alVerGrupo(jid, nombre);
      return nombre;
    } catch {
      return "Grupo sin nombre";
    }
  }

  function cerrarSocket(): void {
    try { sock?.ev?.removeAllListeners?.(); } catch { /* ya cerrado */ }
    try { sock?.end?.(undefined); } catch { /* ya cerrado */ }
    sock = null;
  }

  /** El número de teléfono de quien escribe, aunque WhatsApp lo esconda tras un identificador «@lid». */
  async function numeroDe(msg: any, jid: string): Promise<string | null> {
    const candidatos = [msg.key.remoteJidAlt, msg.key.senderPn, msg.key.participantPn, jid].filter((j): j is string => typeof j === "string");
    for (const j of candidatos) if (j.endsWith("@s.whatsapp.net")) return j.split(/[:@]/)[0]!.replace(/\D/g, "") || null;
    try {
      const pn = await sock?.signalRepository?.lidMapping?.getPNForLID?.(jid);
      if (typeof pn === "string" && pn) return pn.split(/[:@]/)[0]!.replace(/\D/g, "") || null;
    } catch { /* sin mapa todavía */ }
    return null;
  }

  async function privado(msg: any, jid: string): Promise<void> {
    const m = desenvolver(msg.message);
    const texto = m?.conversation ?? m?.extendedTextMessage?.text ?? m?.imageMessage?.caption ?? m?.videoMessage?.caption ?? m?.documentMessage?.caption ?? "";
    const adjuntos: Adjunto[] = [];
    let fallidos = 0;
    for (const pieza of piezasDe(m)) {
      if (pieza.bytes && pieza.bytes > MAX_DESCARGA) { fallidos++; continue; }
      try {
        const datos = await baileysCargado.downloadMediaMessage({ ...msg, message: m }, "buffer", {}, { reuploadRequest: sock?.updateMediaMessage, logger: silencioso });
        adjuntos.push({ tipo: pieza.tipo, datos: Buffer.from(datos), mime: pieza.mime.split(";")[0]!.trim(), nombre: pieza.nombre });
      } catch {
        fallidos++;
      }
    }
    if (!texto && !adjuntos.length && !fallidos) return;
    const numero = await numeroDe(msg, jid);
    deps.alRecibir({
      plataforma: "whatsapp", chatId: jid, chatNombre: msg.pushName || (numero ? `+${numero}` : "alguien"), autor: msg.pushName || (numero ? `+${numero}` : "alguien"),
      texto: fallidos ? `${texto}\n(Hay ${fallidos} archivo${fallidos > 1 ? "s" : ""} que no se pudo traer.)`.trim() : texto,
      fecha: Number(msg.messageTimestamp) * 1000 || Date.now(), mensajeId: String(msg.key.id ?? ""), aludeAlBot: true, privado: true,
      ...(numero ? { remitente: numero } : {}), adjuntos,
    });
  }

  async function conectar(): Promise<void> {
    reintento = null;
    if (!vivo) return;
    const lib = await cargarBaileys().catch((error) => { deps.log?.(`grupos whatsapp: no se pudo cargar la librería: ${error instanceof Error ? error.message : String(error)}`); return null; });
    if (!lib) {
      estado = { estado: "error", error: "Este servidor no tiene instalada la librería de WhatsApp." };
      vivo = false;
      return;
    }
    if (!vivo) return;
    const { baileys, pino } = lib;
    baileysCargado = baileys;
    silencioso = pino({ level: "silent" });
    mkdirSync(deps.sesionDir, { recursive: true, mode: 0o700 });
    const { state, saveCreds } = await baileys.useMultiFileAuthState(deps.sesionDir);
    let version: unknown;
    try { version = (await baileys.fetchLatestBaileysVersion())?.version; } catch { version = undefined; }
    if (!vivo) return;
    estado = { estado: "conectando" };
    cerrarSocket();
    sock = baileys.makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      logger: silencioso,
      printQRInTerminal: false,
      browser: ["OpenBot", "Chrome", "120.0"],
      syncFullHistory: false,
      markOnlineOnConnect: false,
      getMessage: async () => ({ conversation: "" }),
    });
    const yo = () => {
      const ids = [sock?.user?.id, sock?.user?.lid].filter(Boolean).map((id: string) => baileys.jidNormalizedUser(id));
      return new Set<string>(ids);
    };
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", (u: any) => {
      if (u.qr) {
        qrs++;
        // Cada código dura unos 20 segundos; tras unos dos minutos sin escanear se deja de intentar.
        if (qrs > 6) {
          estado = { estado: "error", error: "No se escaneó el código a tiempo. Pulsa «Vincular» para probar otra vez." };
          vivo = false;
          cerrarSocket();
          return;
        }
        estado = { estado: "esperando-qr", qr: String(u.qr) };
      }
      if (u.connection === "open") {
        qrs = 0;
        const numero = String(sock?.user?.id ?? "").split(/[:@]/)[0];
        estado = { estado: "conectado", ...(numero ? { cuenta: `+${numero}` } : {}) };
        void sock.groupFetchAllParticipating?.().then((todos: Record<string, { id: string; subject?: string }>) => {
          for (const g of Object.values(todos ?? {})) { nombres.set(g.id, g.subject || "Grupo sin nombre"); deps.alVerGrupo(g.id, g.subject || "Grupo sin nombre"); }
        }).catch(() => undefined);
      }
      if (u.connection === "close") {
        const code = u.lastDisconnect?.error?.output?.statusCode;
        cerrarSocket();
        if (code === baileys.DisconnectReason?.loggedOut) {
          rmSync(deps.sesionDir, { recursive: true, force: true });
          estado = { estado: "error", error: "Se cerró la sesión de WhatsApp desde el teléfono. Vuelve a vincular si quieres seguir." };
          vivo = false;
          deps.alDesvincular();
          return;
        }
        if (!vivo) return;
        estado = { estado: "conectando", error: `Conexión perdida (${code ?? "sin código"}). Reconectando…` };
        reintento = setTimeout(() => { void conectar(); }, code === 515 ? 1000 : 5000);
      }
    });
    sock.ev.on("groups.update", (cambios: Array<{ id?: string; subject?: string }>) => {
      for (const c of cambios ?? []) if (c.id && c.subject) { nombres.set(c.id, c.subject); deps.alVerGrupo(c.id, c.subject); }
    });
    sock.ev.on("messages.upsert", async ({ messages, type }: { messages: any[]; type: string }) => {
      if (type !== "notify") return;
      for (const msg of messages ?? []) {
        try {
          const jid = String(msg?.key?.remoteJid ?? "");
          if (msg.key.fromMe || !msg.message) continue;
          if (jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid")) { await privado(msg, jid); continue; }
          if (!jid.endsWith("@g.us")) continue;
          const m = desenvolver(msg.message);
          const texto = textoDe(m);
          if (!texto) continue;
          const id = String(msg.key.id ?? "");
          recientes.set(id, msg);
          if (recientes.size > 300) recientes.delete(recientes.keys().next().value as string);
          const ctx = contexto(m);
          const mios = yo();
          const mencion = Array.isArray(ctx?.mentionedJid) && ctx.mentionedJid.some((j: string) => mios.has(baileys.jidNormalizedUser(j)));
          const respuesta = typeof ctx?.participant === "string" && mios.has(baileys.jidNormalizedUser(ctx.participant)) && Boolean(ctx?.stanzaId);
          const quien = String(msg.key.participantPn ?? msg.key.participant ?? "").split(/[:@]/)[0];
          deps.alRecibir({
            plataforma: "whatsapp", chatId: jid, chatNombre: await nombreGrupo(jid),
            autor: msg.pushName || (quien ? `+${quien}` : "alguien"), texto,
            fecha: Number(msg.messageTimestamp) * 1000 || Date.now(), mensajeId: id, aludeAlBot: mencion || respuesta,
          });
        } catch (error) {
          deps.log?.(`grupos whatsapp: mensaje no guardado: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
  }

  return {
    estado: () => estado,
    vinculado,
    numero: () => (estado.estado === "conectado" && estado.cuenta ? estado.cuenta.replace(/\D/g, "") : null),
    arrancar() {
      if (vivo) return;
      vivo = true;
      qrs = 0;
      void conectar().catch((error) => {
        estado = { estado: "error", error: `No se pudo conectar con WhatsApp: ${error instanceof Error ? error.message : String(error)}` };
        vivo = false;
      });
    },
    async parar() {
      vivo = false;
      if (reintento) clearTimeout(reintento);
      reintento = null;
      cerrarSocket();
      estado = { estado: "apagado" };
    },
    async desvincular() {
      vivo = false;
      if (reintento) clearTimeout(reintento);
      try { await sock?.logout?.(); } catch { /* sin conexión: basta con borrar la sesión */ }
      cerrarSocket();
      if (existsSync(deps.sesionDir)) rmSync(deps.sesionDir, { recursive: true, force: true });
      estado = { estado: "apagado" };
    },
    async responder(chatId, texto, aMensajeId) {
      if (!sock || estado.estado !== "conectado") throw new Error("WhatsApp no está conectado.");
      const citado = recientes.get(aMensajeId);
      await sock.sendMessage(chatId, { text: texto.slice(0, MAX_RESPUESTA) }, citado ? { quoted: citado } : undefined);
    },
    async enviar(chatId, texto) {
      if (!sock || estado.estado !== "conectado") throw new Error("WhatsApp no está conectado.");
      for (const trozo of trocear(texto)) await sock.sendMessage(chatId, { text: trozo });
      void sock.sendPresenceUpdate?.("paused", chatId)?.catch?.(() => undefined);
    },
    async enviarArchivo(chatId, archivo: ArchivoSaliente) {
      if (!sock || estado.estado !== "conectado") throw new Error("WhatsApp no está conectado.");
      const datos = readFileSync(archivo.path);
      const foto = archivo.mime.startsWith("image/") && !archivo.mime.includes("svg");
      await sock.sendMessage(chatId, foto
        ? { image: datos, mimetype: archivo.mime, ...(archivo.texto ? { caption: archivo.texto } : {}) }
        : { document: datos, mimetype: archivo.mime, fileName: archivo.nombre, ...(archivo.texto ? { caption: archivo.texto } : {}) });
    },
    escribiendo(chatId) {
      if (!sock || estado.estado !== "conectado") return;
      void Promise.resolve(sock.sendPresenceUpdate?.("composing", chatId)).catch(() => undefined);
    },
  };
}
