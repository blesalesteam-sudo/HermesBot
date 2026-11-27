// OpenBot: conector de Telegram por la Bot API oficial (consulta larga con getUpdates, sin librerías).
// Sirve para dos cosas: leer grupos (server/grupos) y hablar en privado con los bots (server/canales).
// Para leer todo lo que se dice en un grupo, el bot necesita el modo privacidad apagado en BotFather (y volver a
// entrar en el grupo después) o ser administrador del grupo; si no, Telegram solo le entrega lo que va dirigido a él.
// Un mismo token no puede tener dos lectores a la vez: si otro programa lo usa, Telegram responde 409 y aquí se avisa.
import { readFileSync } from "node:fs";
import { MAX_RESPUESTA, trocear, type Adjunto, type ArchivoSaliente, type Conector, type Entrante, type EstadoConector } from "./conector.ts";

interface Usuario { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string }
interface Entidad { type: string; offset: number; length: number; user?: Usuario }
interface ArchivoTg { file_id: string; file_size?: number; mime_type?: string; file_name?: string }
interface MensajeTg {
  message_id: number;
  date: number;
  chat: { id: number; type: string; title?: string };
  from?: Usuario;
  sender_chat?: { title?: string };
  text?: string;
  caption?: string;
  entities?: Entidad[];
  caption_entities?: Entidad[];
  reply_to_message?: { from?: Usuario };
  photo?: ArchivoTg[]; video?: ArchivoTg; voice?: ArchivoTg; audio?: ArchivoTg; document?: ArchivoTg; sticker?: { emoji?: string };
  location?: unknown; contact?: unknown; poll?: { question?: string };
  new_chat_title?: string;
}
interface Update { update_id: number; message?: MensajeTg; edited_message?: MensajeTg; my_chat_member?: { chat: MensajeTg["chat"] } }

export interface TelegramDeps {
  token: () => string | null;
  alRecibir: (m: Entrante) => void;
  /** El bot entró en un grupo o el grupo cambió de nombre, aunque nadie haya escrito aún. */
  alVerGrupo?: (chatId: string, nombre: string) => void;
  /** Contacto propio de un bot: solo chats privados, los grupos se ignoran. */
  soloPrivados?: boolean;
  /** Menú de órdenes que Telegram enseña al pulsar «/». */
  ordenes?: Array<{ command: string; description: string }>;
  log?: (line: string) => void;
  fetch?: typeof fetch;
}

/** Solo para pruebas: otra dirección de la Bot API. */
const API = (process.env.OPENBOT_TELEGRAM_API || "https://api.telegram.org").replace(/\/+$/, "");
/** Lo que Telegram deja descargar a un bot. */
const MAX_DESCARGA = 20 * 1024 * 1024;

const nombreDe = (u?: Usuario) => [u?.first_name, u?.last_name].filter(Boolean).join(" ") || (u?.username ? `@${u.username}` : "alguien");

function textoDe(m: MensajeTg): string {
  const base = m.text ?? m.caption ?? "";
  const extra = m.photo ? "[foto]" : m.video ? "[vídeo]" : m.voice ? "[nota de voz]" : m.audio ? "[audio]" : m.document ? `[archivo: ${m.document.file_name ?? "sin nombre"}]`
    : m.sticker ? `[sticker ${m.sticker.emoji ?? ""}]` : m.location ? "[ubicación]" : m.contact ? "[contacto]" : m.poll ? `[encuesta: ${m.poll.question ?? ""}]` : "";
  return [extra, base].filter(Boolean).join(" ").trim();
}

export type ConectorTelegram = Conector & { usuario(): string | null };

export function crearTelegram(deps: TelegramDeps): ConectorTelegram {
  const http = deps.fetch ?? fetch;
  let estado: EstadoConector = { estado: "apagado" };
  let vivo = false;
  let corte: AbortController | null = null;
  let bucle: Promise<void> | null = null;
  let yo: Usuario | null = null;

  async function llamar<T>(token: string, metodo: string, cuerpo: Record<string, unknown> | FormData, signal?: AbortSignal): Promise<T> {
    const form = cuerpo instanceof FormData;
    const res = await http(`${API}/bot${token}/${metodo}`, {
      method: "POST", ...(form ? {} : { headers: { "content-type": "application/json" } }), body: form ? cuerpo : JSON.stringify(cuerpo), signal,
    });
    const data = await res.json().catch(() => null) as { ok?: boolean; result?: T; description?: string; error_code?: number } | null;
    if (!data?.ok) throw Object.assign(new Error(data?.description || `Telegram respondió ${res.status}`), { code: data?.error_code ?? res.status });
    return data.result as T;
  }

  function aludeAlBot(m: MensajeTg): boolean {
    if (!yo) return false;
    if (m.reply_to_message?.from?.id === yo.id) return true;
    const texto = m.text ?? m.caption ?? "";
    for (const e of [...(m.entities ?? []), ...(m.caption_entities ?? [])]) {
      if (e.type === "text_mention" && e.user?.id === yo.id) return true;
      if (e.type === "mention" && yo.username && texto.slice(e.offset, e.offset + e.length).toLowerCase() === `@${yo.username.toLowerCase()}`) return true;
    }
    return false;
  }

  async function descargar(token: string, archivo: ArchivoTg): Promise<Buffer | null> {
    if (archivo.file_size && archivo.file_size > MAX_DESCARGA) return null;
    const info = await llamar<{ file_path?: string }>(token, "getFile", { file_id: archivo.file_id });
    if (!info.file_path) return null;
    const res = await http(`${API}/file/bot${token}/${info.file_path}`);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  /** Solo en privado: las fotos, archivos y notas de voz se traen para dárselos al bot. */
  async function adjuntosDe(token: string, m: MensajeTg): Promise<{ adjuntos: Adjunto[]; fallidos: number }> {
    const piezas: Array<{ tipo: Adjunto["tipo"]; archivo: ArchivoTg; mime: string; nombre: string }> = [];
    if (m.photo?.length) piezas.push({ tipo: "imagen", archivo: m.photo[m.photo.length - 1]!, mime: "image/jpeg", nombre: "foto.jpg" });
    if (m.document) piezas.push({ tipo: m.document.mime_type?.startsWith("image/") ? "imagen" : "archivo", archivo: m.document, mime: m.document.mime_type ?? "application/octet-stream", nombre: m.document.file_name ?? "archivo" });
    if (m.voice) piezas.push({ tipo: "audio", archivo: m.voice, mime: m.voice.mime_type ?? "audio/ogg", nombre: "nota-de-voz.ogg" });
    if (m.audio) piezas.push({ tipo: "audio", archivo: m.audio, mime: m.audio.mime_type ?? "audio/mpeg", nombre: m.audio.file_name ?? "audio" });
    if (m.video) piezas.push({ tipo: "archivo", archivo: m.video, mime: m.video.mime_type ?? "video/mp4", nombre: m.video.file_name ?? "video.mp4" });
    const adjuntos: Adjunto[] = [];
    let fallidos = 0;
    for (const p of piezas) {
      try {
        const datos = await descargar(token, p.archivo);
        if (datos) adjuntos.push({ tipo: p.tipo, datos, mime: p.mime, nombre: p.nombre }); else fallidos++;
      } catch {
        fallidos++;
      }
    }
    return { adjuntos, fallidos };
  }

  async function tratar(token: string, u: Update): Promise<void> {
    if (u.my_chat_member && u.my_chat_member.chat.type !== "private") {
      if (!deps.soloPrivados) deps.alVerGrupo?.(String(u.my_chat_member.chat.id), u.my_chat_member.chat.title ?? "Grupo sin nombre");
      return;
    }
    const m = u.message ?? u.edited_message;
    if (!m || m.from?.id === yo?.id || m.from?.is_bot) return;
    if (m.chat.type === "private") {
      // Una edición en privado no se reenvía al bot: ya contestó al original.
      if (u.edited_message || !m.from) return;
      const { adjuntos, fallidos } = await adjuntosDe(token, m);
      const texto = m.text || m.caption || "";
      deps.alRecibir({
        plataforma: "telegram", chatId: String(m.chat.id), chatNombre: nombreDe(m.from), autor: nombreDe(m.from),
        texto: fallidos ? `${texto}\n(Hay ${fallidos} archivo${fallidos > 1 ? "s" : ""} que no se pudo traer: Telegram solo deja a los bots archivos de hasta 20 MB.)`.trim() : texto,
        fecha: m.date * 1000, mensajeId: String(m.message_id), aludeAlBot: true, privado: true, remitente: String(m.from.id), adjuntos,
      });
      return;
    }
    if (deps.soloPrivados || (m.chat.type !== "group" && m.chat.type !== "supergroup")) return;
    const chatId = String(m.chat.id);
    const nombre = m.new_chat_title ?? m.chat.title ?? "Grupo sin nombre";
    deps.alVerGrupo?.(chatId, nombre);
    const texto = textoDe(m);
    if (!texto) return;
    deps.alRecibir({
      plataforma: "telegram", chatId, chatNombre: nombre,
      autor: m.sender_chat?.title ?? nombreDe(m.from),
      texto: u.edited_message ? `(editado) ${texto}` : texto,
      fecha: m.date * 1000, mensajeId: String(m.message_id), aludeAlBot: !u.edited_message && aludeAlBot(m),
      ...(m.from ? { remitente: String(m.from.id) } : {}),
    });
  }

  async function correr(): Promise<void> {
    let offset = 0;
    let espera = 1000;
    while (vivo) {
      const token = deps.token();
      if (!token) { estado = { estado: "error", error: "Falta el token del bot de Telegram." }; return; }
      try {
        if (!yo) {
          estado = { estado: "conectando" };
          yo = await llamar<Usuario>(token, "getMe", {});
          if (deps.ordenes?.length) await llamar(token, "setMyCommands", { commands: deps.ordenes }).catch(() => undefined);
        }
        estado = { estado: "conectado", cuenta: yo.username ? `@${yo.username}` : nombreDe(yo) };
        corte = new AbortController();
        const updates = await llamar<Update[]>(token, "getUpdates", { offset, timeout: 50, allowed_updates: ["message", "edited_message", "my_chat_member"] }, corte.signal);
        espera = 1000;
        for (const u of updates) {
          offset = u.update_id + 1;
          try { await tratar(token, u); } catch (error) { deps.log?.(`telegram: mensaje no tratado: ${error instanceof Error ? error.message : String(error)}`); }
        }
      } catch (error) {
        if (!vivo) return;
        const code = (error as { code?: number }).code;
        const motivo = code === 401 || code === 404 ? "Telegram no reconoce el token. Revisa que esté bien copiado de BotFather."
          : code === 409 ? "Otro programa está leyendo este mismo bot de Telegram. Usa un bot solo para OpenBot."
          : `No se pudo hablar con Telegram (${error instanceof Error ? error.message : String(error)}). Se reintenta solo.`;
        estado = { estado: "error", error: motivo };
        if (code === 401 || code === 404) { yo = null; return; }
        await new Promise((r) => setTimeout(r, espera));
        espera = Math.min(espera * 2, 60_000);
      }
    }
  }

  const tokenOError = () => {
    const token = deps.token();
    if (!token) throw new Error("Telegram no está conectado.");
    return token;
  };

  return {
    estado: () => estado,
    usuario: () => yo?.username ?? null,
    arrancar() {
      if (vivo) return;
      vivo = true;
      yo = null;
      bucle = correr().finally(() => { if (!vivo) estado = { estado: "apagado" }; vivo = false; });
    },
    async parar() {
      vivo = false;
      corte?.abort();
      await bucle?.catch(() => undefined);
      bucle = null;
      estado = { estado: "apagado" };
    },
    async responder(chatId, texto, aMensajeId) {
      await llamar(tokenOError(), "sendMessage", {
        chat_id: chatId, text: texto.slice(0, MAX_RESPUESTA),
        reply_parameters: { message_id: Number(aMensajeId), allow_sending_without_reply: true },
        link_preview_options: { is_disabled: true },
      });
    },
    async enviar(chatId, texto) {
      const token = tokenOError();
      for (const trozo of trocear(texto)) await llamar(token, "sendMessage", { chat_id: chatId, text: trozo, link_preview_options: { is_disabled: true } });
    },
    async enviarArchivo(chatId, archivo: ArchivoSaliente) {
      const token = tokenOError();
      const foto = archivo.mime.startsWith("image/") && !archivo.mime.includes("svg");
      const form = new FormData();
      form.set("chat_id", chatId);
      if (archivo.texto) form.set("caption", archivo.texto.slice(0, 1000));
      form.set(foto ? "photo" : "document", new Blob([readFileSync(archivo.path)], { type: archivo.mime }), archivo.nombre);
      await llamar(token, foto ? "sendPhoto" : "sendDocument", form);
    },
    escribiendo(chatId) {
      const token = deps.token();
      if (token) void llamar(token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
    },
  };
}
