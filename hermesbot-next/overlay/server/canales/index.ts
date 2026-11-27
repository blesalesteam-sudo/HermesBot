// OpenBot: los bots en WhatsApp y Telegram. Una persona autorizada habla con cualquier bot (el principal, el jefe, el
// de tareas…) desde su móvil exactamente como en la app: mismo bot, mismas herramientas, misma memoria, mismo nivel.
// - WhatsApp: un solo número para OpenBot. Se habla con el «bot activo»; «@Nombre …» o /bots cambian de bot.
// - Telegram: un contacto general (el mismo bot de los grupos), que funciona como WhatsApp, y si se quiere un contacto
//   propio para cada bot (su token de @BotFather), donde solo habla ese bot.
// - Cada bot tiene una conversación propia por persona y aplicación («WhatsApp · Daniel»), visible en la app.
// - Lo que el bot escribe en esa conversación (respuestas, recordatorios, resultados de rutinas, archivos, preguntas)
//   llega al móvil. Además, si la persona quiere: permisos y preguntas, trabajos terminados y fallos de los demás chats.
// Solo hablan las personas vinculadas con un código de un solo uso que se saca en Ajustes. A cualquier otro número o
// cuenta no se le contesta nada.
import { existsSync } from "node:fs";
import { randomInt, randomUUID } from "node:crypto";
import type { AppConfig } from "../config.ts";
import type { Message, StoreChange } from "../store.ts";
import type { Notification } from "../../packages/phone-protocol/src/notification.ts";
import type { Conector, Entrante } from "../grupos/conector.ts";
import { crearTelegram, type ConectorTelegram } from "../grupos/telegram.ts";
import type { ConectorWhatsapp } from "../grupos/whatsapp.ts";
import { ORDENES_TELEGRAM } from "../grupos/index.ts";
import {
  AVISOS_POR_DEFECTO, CANALES, guardarCanales, guardarTokenPropio, leerCanales, tokenPropio, TOKEN_TELEGRAM,
  type AjustesCanales, type Avisos, type Canal, type Persona,
} from "./ajustes.ts";
import { esNo, esSi, formatear, normal, opcionEnEspanol } from "./formato.ts";
import { guardarAdjunto, transcribir } from "./voz.ts";

export interface BotInfo { id: string; name: string; principal: boolean; jefe: boolean }

export interface CanalesDeps {
  dataDir: string;
  conectores: { telegram: ConectorTelegram; whatsapp: ConectorWhatsapp };
  alRecibirPrivado: (fn: (e: Entrante, conector: Conector) => void) => void;
  bots: () => BotInfo[];
  /** Las personas de OpenBot (cuentas), para firmar sus mensajes con su nombre. */
  personasOpenbot: () => Array<{ clave: string; nombre: string }>;
  /** Manda el mensaje al bot por el mismo camino que la caja de escribir de la app. */
  enviar: (input: { botId: string; threadId: string; texto: string; sendId: string; remitente?: { name: string; id: string } }) => Promise<{ ok: true; enCola: boolean } | { ok: false; motivo: string }>;
  crearConversacion: (botId: string, titulo: string) => string | null;
  conversacionExiste: (botId: string, threadId: string) => boolean;
  mensajes: (threadId: string) => Message[];
  alCambiar: (fn: (c: StoreChange) => void) => () => void;
  /** Contesta a una tarjeta de permiso o pregunta como lo haría el dueño en la app. Devuelve el error o null. */
  responderTarjeta: (threadId: string, requestId: string, respuesta: { behavior: "allow" | "deny" | "answer"; message?: string }) => Promise<string | null>;
  parar: (botId: string, threadId: string) => Promise<void>;
  config: () => AppConfig;
  log?: (line: string) => void;
}

interface Pendiente {
  threadId: string;
  requestId: string;
  opciones: string[];
  permiso: boolean;
  botId: string;
  expira: number;
}

const CODIGO_MS = 15 * 60_000;
const ELECCION_MS = 5 * 60_000;
const PENDIENTE_MS = 24 * 3600_000;
const ESCRIBIENDO_MAX_MS = 5 * 60_000;
/** Si el mismo bot sigue hablando, no se repite su nombre delante hasta pasado este rato. */
const NOMBRE_CADA_MS = 30 * 60_000;
const APP = { whatsapp: "WhatsApp", telegram: "Telegram" } as const;

const clave = (persona: string, canal: Canal, botId: string) => `${persona}|${canal}|${botId}`;

export function crearCanales(deps: CanalesDeps) {
  const log = deps.log ?? ((line: string) => console.error(line));
  let ajustes = leerCanales(deps.dataDir);
  const guardar = () => guardarCanales(deps.dataDir, ajustes);

  const codigos = new Map<string, { persona: string; expira: number }>();
  const eligiendo = new Map<string, { bots: string[]; expira: number }>();
  /** "persona|canal|contacto" → tarjetas esperando respuesta, la más nueva al final. */
  const pendientes = new Map<string, Pendiente[]>();
  const escribiendo = new Map<string, { timer: ReturnType<typeof setInterval>; hasta: number }>();
  const ultimoQueHablo = new Map<string, { botId: string; at: number }>();
  const reenviados = new Set<string>();
  const propios = new Map<string, ConectorTelegram>();

  // ---------- quién es quién ----------

  const disponibles = (canal: Canal) => deps.bots().filter((b) => ajustes.bots[b.id]?.[canal]);
  const botPorId = (id: string) => deps.bots().find((b) => b.id === id);
  const personaPorId = (id: string) => ajustes.personas.find((p) => p.id === id);
  const personaDe = (canal: Canal, remitente?: string) => remitente ? ajustes.personas.find((p) => (canal === "whatsapp" ? p.whatsapp : p.telegram) === remitente) : undefined;

  function botActivo(persona: Persona, canal: Canal): BotInfo | null {
    const lista = disponibles(canal);
    return lista.find((b) => b.id === persona.botActivo[canal]) ?? lista.find((b) => b.principal) ?? lista[0] ?? null;
  }

  function remitenteDe(persona: Persona): { name: string; id: string } | undefined {
    if (!persona.clave) return undefined;
    const openbot = deps.personasOpenbot().find((p) => p.clave === persona.clave);
    return { name: openbot?.nombre || persona.nombre, id: persona.clave };
  }

  // ---------- salida hacia el móvil ----------

  function conectorPara(canal: Canal, contacto: "general" | "propio", botId: string): Conector | null {
    if (canal === "whatsapp") return deps.conectores.whatsapp;
    if (contacto === "propio") {
      const propio = propios.get(botId);
      if (propio?.estado().estado === "conectado") return propio;
    }
    return deps.conectores.telegram;
  }

  async function decir(persona: Persona, canal: Canal, texto: string, opts: { contacto?: "general" | "propio"; botId?: string } = {}): Promise<boolean> {
    const chat = persona.chat[canal];
    const conector = conectorPara(canal, opts.contacto ?? "general", opts.botId ?? "");
    if (!chat || !conector) return false;
    try {
      await conector.enviar(chat, texto);
      return true;
    } catch (error) {
      log(`canales: no se pudo escribir a ${persona.nombre} por ${APP[canal]}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /** El nombre del bot delante cuando por ese número hablan varios bots y acaba de cambiar quién habla. */
  function cabecera(persona: Persona, canal: Canal, contacto: "general" | "propio", bot: BotInfo | undefined): string {
    if (!bot || contacto === "propio" || disponibles(canal).length < 2) return "";
    const k = `${persona.id}|${canal}`;
    const ultimo = ultimoQueHablo.get(k);
    ultimoQueHablo.set(k, { botId: bot.id, at: Date.now() });
    if (ultimo?.botId === bot.id && Date.now() - ultimo.at < NOMBRE_CADA_MS) return "";
    return canal === "whatsapp" ? `*${bot.name}*\n` : `${bot.name}:\n`;
  }

  function dejarDeEscribir(threadId: string): void {
    const e = escribiendo.get(threadId);
    if (e) clearInterval(e.timer);
    escribiendo.delete(threadId);
  }

  function empezarAEscribir(threadId: string, conector: Conector, chat: string): void {
    dejarDeEscribir(threadId);
    conector.escribiendo(chat);
    const hasta = Date.now() + ESCRIBIENDO_MAX_MS;
    const timer = setInterval(() => {
      if (Date.now() > hasta) { dejarDeEscribir(threadId); return; }
      conector.escribiendo(chat);
    }, 4_500);
    escribiendo.set(threadId, { timer, hasta });
  }

  function textoTarjeta(m: Message, bot: BotInfo | undefined, enOtraConversacion: boolean): { texto: string; pendiente: Omit<Pendiente, "threadId" | "expira" | "botId"> } | null {
    const card = m.card;
    if (!card?.requestId || card.answered || card.dismissed) return null;
    const permiso = Boolean(card.tool) || card.requestType === "permission";
    const opciones = card.options?.length ? card.options : permiso ? ["Allow", "Deny"] : [];
    const quien = bot?.name ?? "Un bot";
    const lineas = [
      permiso ? `🔐 ${quien} necesita tu permiso${enOtraConversacion ? " (en otra conversación)" : ""}:` : `❓ ${quien} te pregunta${enOtraConversacion ? " (en otra conversación)" : ""}:`,
      card.title,
      ...(card.subtitle && card.subtitle !== card.title ? [card.subtitle] : []),
      "",
      ...opciones.map((o, i) => `${i + 1}. ${opcionEnEspanol(o)}`),
      "",
      permiso ? "Responde con el número, o «sí» / «no»." : opciones.length ? "Responde con el número de la opción." : "Responde escribiendo tu respuesta.",
    ];
    return { texto: lineas.join("\n"), pendiente: { requestId: card.requestId, opciones, permiso } };
  }

  function guardarPendiente(persona: Persona, canal: Canal, contacto: string, p: Pendiente): void {
    const k = `${persona.id}|${canal}|${contacto}`;
    const lista = (pendientes.get(k) ?? []).filter((x) => x.requestId !== p.requestId && x.expira > Date.now());
    lista.push(p);
    pendientes.set(k, lista.slice(-10));
  }

  async function reenviar(threadId: string, m: Message): Promise<void> {
    const conv = ajustes.conversaciones[threadId];
    const persona = conv && personaPorId(conv.persona);
    if (!conv || !persona || m.role !== "bot" || reenviados.has(m.id)) return;
    const bot = botPorId(conv.botId);
    const contactoKey = conv.contacto === "propio" ? conv.botId : "general";
    if (m.kind === "options") {
      const tarjeta = textoTarjeta(m, bot, false);
      if (!tarjeta) return;
      reenviados.add(m.id);
      dejarDeEscribir(threadId);
      guardarPendiente(persona, conv.canal, contactoKey, { ...tarjeta.pendiente, threadId, botId: conv.botId, expira: Date.now() + PENDIENTE_MS });
      await decir(persona, conv.canal, cabecera(persona, conv.canal, conv.contacto, bot) + tarjeta.texto, { contacto: conv.contacto, botId: conv.botId });
      return;
    }
    if (m.kind !== "text") return;
    const texto = m.text ? formatear(m.text, conv.canal) : "";
    const archivos = (m.attachments ?? []).filter((a) => a.kind !== "audio" && existsSync(a.path));
    if (!texto && !archivos.length) return;
    reenviados.add(m.id);
    if (reenviados.size > 5000) reenviados.delete(reenviados.values().next().value as string);
    if (m.turnTerminal) dejarDeEscribir(threadId);
    if (texto) await decir(persona, conv.canal, cabecera(persona, conv.canal, conv.contacto, bot) + texto, { contacto: conv.contacto, botId: conv.botId });
    const conector = conectorPara(conv.canal, conv.contacto, conv.botId);
    for (const a of archivos) {
      try {
        if (persona.chat[conv.canal] && conector) await conector.enviarArchivo(persona.chat[conv.canal]!, { path: a.path, mime: a.mime, nombre: "name" in a && a.name ? a.name : a.path.split("/").pop() ?? "archivo" });
      } catch (error) {
        log(`canales: no se pudo mandar un archivo a ${persona.nombre}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const desuscribir = deps.alCambiar((c) => {
    if (c.type === "message" && ajustes.conversaciones[c.threadId]) void reenviar(c.threadId, c.message);
    // La petición terminó (también si no hubo texto): fuera el «escribiendo…».
    if (c.type === "message.patch" && c.message.role === "user" && c.message.requestPending === false) dejarDeEscribir(c.threadId);
    if (c.type === "thread.deleted" && ajustes.conversaciones[c.threadId]) {
      delete ajustes.conversaciones[c.threadId];
      for (const [k, hilo] of Object.entries(ajustes.actuales)) if (hilo === c.threadId) delete ajustes.actuales[k];
      guardar();
    }
  });

  // ---------- avisos de otras conversaciones ----------

  function categoria(kind: string): keyof Avisos | null {
    if (kind === "approval" || kind === "question") return "permisos";
    if (kind === "done") return "terminadas";
    if (kind === "routine-failed" || kind === "turn-failed" || kind === "incident") return "fallos";
    return null;
  }

  async function aviso(n: Notification | null): Promise<void> {
    if (!n || ajustes.conversaciones[n.threadId]) return;
    const cat = categoria(n.kind);
    if (!cat) return;
    const bot = botPorId(n.botId);
    const destinatarios = ajustes.personas.filter((p) => p.avisos[cat] && (!n.forPerson || !p.clave || p.clave === n.forPerson));
    for (const persona of destinatarios) {
      const canal = persona.avisosPor && persona.chat[persona.avisosPor] ? persona.avisosPor : CANALES.find((c) => persona.chat[c]);
      if (!canal) continue;
      const contacto: "general" | "propio" = canal === "telegram" && ajustes.contactoPropio[n.botId] && propios.get(n.botId)?.estado().estado === "conectado" ? "propio" : "general";
      if (cat === "permisos") {
        const card = [...deps.mensajes(n.threadId)].reverse().find((m) => m.card?.requestId && !m.card.answered && !m.card.dismissed);
        const tarjeta = card && textoTarjeta(card, bot, true);
        if (!tarjeta || reenviados.has(`${persona.id}:${card.id}`)) continue;
        reenviados.add(`${persona.id}:${card.id}`);
        guardarPendiente(persona, canal, contacto === "propio" ? n.botId : "general", { ...tarjeta.pendiente, threadId: n.threadId, botId: n.botId, expira: Date.now() + PENDIENTE_MS });
        await decir(persona, canal, tarjeta.texto, { contacto, botId: n.botId });
        continue;
      }
      const titulo = cat === "terminadas" ? `✅ ${n.botName} ha terminado` : `⚠️ ${n.botName}: algo ha fallado`;
      const cuerpo = [n.title, n.body].filter((t) => t && t.trim()).join("\n");
      await decir(persona, canal, `${titulo}${cuerpo ? `\n${formatear(cuerpo, canal).slice(0, 1500)}` : ""}`, { contacto, botId: n.botId });
    }
  }

  // ---------- entrada desde el móvil ----------

  function ayuda(persona: Persona, canal: Canal, propio: BotInfo | null): string {
    const b = (t: string) => (canal === "whatsapp" ? `*${t}*` : t);
    const bot = propio ?? botActivo(persona, canal);
    if (!bot) return `Todavía no hay ningún bot disponible por ${APP[canal]}. Actívalos en OpenBot → Ajustes → Funciones → Bots en WhatsApp y Telegram.`;
    const lineas = [
      `Hola, ${persona.nombre} 👋 Estás hablando con ${b(bot.name)}.`,
      "",
      "• Escribe normal: te contesta igual que en la app, con sus herramientas y su memoria.",
      ...(propio ? [`• Este contacto es solo de ${b(bot.name)}.`] : [
        `• ${b("@Nombre")} y tu mensaje: hablar con otro bot (por ejemplo «@Tareas recuérdame mañana llamar a Juan»).`,
        `• ${b("/bots")}: ver los bots y elegir con cuál hablar.`,
      ]),
      `• ${b("/nuevo")}: empezar una conversación nueva con este bot.`,
      `• ${b("/parar")}: parar lo que está haciendo.`,
      "• Puedes mandar fotos, documentos y notas de voz.",
      "",
      `Todo queda también en la app, en la conversación «${APP[canal]} · ${persona.nombre}» de cada bot.`,
    ];
    return lineas.join("\n");
  }

  function listaBots(persona: Persona, canal: Canal): string {
    const lista = disponibles(canal);
    if (!lista.length) return ayuda(persona, canal, null);
    const activo = botActivo(persona, canal);
    eligiendo.set(`${persona.id}|${canal}`, { bots: lista.map((b) => b.id), expira: Date.now() + ELECCION_MS });
    return [
      "¿Con qué bot quieres hablar? Responde con el número:",
      "",
      ...lista.map((b, i) => `${i + 1}. ${b.name}${b.principal ? " (principal)" : b.jefe ? " (jefe)" : ""}${b.id === activo?.id ? "  ← ahora" : ""}`),
      "",
      "También puedes escribir «@Nombre» delante de tu mensaje.",
    ].join("\n");
  }

  function elegir(persona: Persona, canal: Canal, bot: BotInfo): string {
    persona.botActivo[canal] = bot.id;
    guardar();
    ultimoQueHablo.delete(`${persona.id}|${canal}`);
    return canal === "whatsapp" ? `Ahora hablas con *${bot.name}*. Escríbele lo que necesites.` : `Ahora hablas con ${bot.name}. Escríbele lo que necesites.`;
  }

  /** «@Tareas recuérdame…» → el bot cuyo nombre empieza así, y el resto del mensaje. */
  function botMencionado(texto: string, canal: Canal): { bot: BotInfo; resto: string } | null {
    const m = /^@(\S[^\n]*)$/s.exec(texto.trim());
    if (!m) return null;
    const dicho = normal(m[1]!);
    const candidatos = disponibles(canal).map((b) => ({ b, n: normal(b.name) })).sort((a, z) => z.n.length - a.n.length);
    for (const { b, n } of candidatos) {
      if (dicho === n || dicho.startsWith(`${n} `) || dicho.startsWith(`${n},`) || dicho.startsWith(`${n}:`)) {
        return { bot: b, resto: m[1]!.trim().slice(b.name.length).replace(/^[\s,:]+/, "") };
      }
    }
    // Una sola palabra que coincide con el principio de un nombre («@tar» → Tareas).
    const primera = dicho.split(" ")[0]!;
    const parecidos = candidatos.filter(({ n }) => n.startsWith(primera));
    if (parecidos.length === 1) return { bot: parecidos[0]!.b, resto: m[1]!.trim().split(/\s+/).slice(1).join(" ") };
    return null;
  }

  function conversacionActual(persona: Persona, canal: Canal, bot: BotInfo, contacto: "general" | "propio", nueva = false): string | null {
    const k = clave(persona.id, canal, bot.id);
    let hilo = nueva ? undefined : ajustes.actuales[k];
    if (hilo && !deps.conversacionExiste(bot.id, hilo)) hilo = undefined;
    if (!hilo) {
      hilo = deps.crearConversacion(bot.id, `${APP[canal]} · ${persona.nombre}`) ?? undefined;
      if (!hilo) return null;
      ajustes.actuales[k] = hilo;
    }
    ajustes.conversaciones[hilo] = { botId: bot.id, persona: persona.id, canal, contacto };
    guardar();
    return hilo;
  }

  async function contestarTarjeta(persona: Persona, canal: Canal, contactoKey: string, texto: string): Promise<boolean> {
    const k = `${persona.id}|${canal}|${contactoKey}`;
    const vivas = (pendientes.get(k) ?? []).filter((p) => p.expira > Date.now() && deps.mensajes(p.threadId).some((m) => m.card?.requestId === p.requestId && !m.card.answered && !m.card.dismissed));
    pendientes.set(k, vivas);
    const p = vivas[vivas.length - 1];
    if (!p) return false;
    const n = /^\s*(\d{1,2})\s*[.)]?\s*$/.exec(texto);
    let respuesta: { behavior: "allow" | "deny" | "answer"; message?: string } | null = null;
    let elegida = "";
    if (n) {
      const opcion = p.opciones[Number(n[1]) - 1];
      if (!opcion) return false;
      elegida = opcion;
      respuesta = p.permiso ? { behavior: /^(deny|don't allow|cancel|no)$/i.test(opcion) ? "deny" : "allow" } : { behavior: "answer", message: opcion };
    } else if (p.permiso && esSi(texto)) {
      elegida = "Allow";
      respuesta = { behavior: "allow" };
    } else if (p.permiso && esNo(texto)) {
      elegida = "Deny";
      respuesta = { behavior: "deny" };
    } else if (!p.permiso) {
      const igual = p.opciones.find((o) => normal(o) === normal(texto) || normal(opcionEnEspanol(o)) === normal(texto));
      if (igual) { elegida = igual; respuesta = { behavior: "answer", message: igual }; }
    }
    if (!respuesta) return false;
    const error = await deps.responderTarjeta(p.threadId, p.requestId, respuesta);
    pendientes.set(k, vivas.filter((x) => x !== p));
    await decir(persona, canal, error ? `No he podido responder: ${error}` : `👍 Hecho: ${opcionEnEspanol(elegida)}.`, { contacto: contactoKey === "general" ? "general" : "propio", botId: p.botId });
    return true;
  }

  async function vincularConCodigo(e: Entrante, canal: Canal, conector: Conector, propio: BotInfo | null): Promise<boolean> {
    const m = /\bOB[-\s]?(\d{6})\b/i.exec(e.texto);
    if (!m || !e.remitente) return false;
    const codigo = `OB${m[1]}`;
    const c = codigos.get(codigo);
    if (!c || c.expira < Date.now()) return false;
    const persona = personaPorId(c.persona);
    if (!persona) return false;
    codigos.delete(codigo);
    // Un número o cuenta solo puede ser de una persona.
    for (const otra of ajustes.personas) if (otra !== persona && (canal === "whatsapp" ? otra.whatsapp : otra.telegram) === e.remitente) {
      if (canal === "whatsapp") delete otra.whatsapp; else delete otra.telegram;
      delete otra.chat[canal];
    }
    if (canal === "whatsapp") persona.whatsapp = e.remitente; else persona.telegram = e.remitente;
    persona.chat[canal] = e.chatId;
    guardar();
    log(`canales: ${persona.nombre} vinculado por ${APP[canal]}`);
    await conector.enviar(e.chatId, `✅ Listo, ${persona.nombre}. Ya puedes hablar con tus bots desde aquí.\n\n${ayuda(persona, canal, propio)}`).catch(() => undefined);
    return true;
  }

  const avisadosDesconocidos = new Map<string, number>();

  async function recibirPrivado(e: Entrante, conector: Conector, propioId?: string): Promise<void> {
    const canal: Canal = e.plataforma;
    const propio = propioId ? botPorId(propioId) ?? null : null;
    if (propioId && !propio) return;
    let persona = personaDe(canal, e.remitente);
    if (!persona) {
      if (await vincularConCodigo(e, canal, conector, propio)) return;
      // A un desconocido no se le contesta (para no delatar el número ni gastar mensajes); solo queda en el registro.
      const k = `${canal}:${e.remitente ?? e.chatId}`;
      if ((avisadosDesconocidos.get(k) ?? 0) < Date.now() - 3600_000) {
        avisadosDesconocidos.set(k, Date.now());
        log(`canales: mensaje de alguien no vinculado por ${APP[canal]} (ignorado)`);
      }
      return;
    }
    if (persona.chat[canal] !== e.chatId) { persona.chat[canal] = e.chatId; guardar(); }
    const contacto: "general" | "propio" = propio ? "propio" : "general";
    const contactoKey = propio ? propio.id : "general";
    const responder = (texto: string) => conector.enviar(e.chatId, texto).catch((error) => log(`canales: ${error instanceof Error ? error.message : String(error)}`));
    const texto = e.texto.trim();
    const orden = normal(texto).replace(/@\w+$/, "");

    // Un código nuevo de alguien ya vinculado (por ejemplo, otro móvil): se acepta igual.
    if (/^\/?start\b/.test(orden) || /\bob[-\s]?\d{6}\b/.test(orden)) {
      if (await vincularConCodigo(e, canal, conector, propio)) return;
      if (/^\/?start\b/.test(orden)) { await responder(ayuda(persona, canal, propio)); return; }
    }
    if (["/ayuda", "ayuda", "/help", "help", "?"].includes(orden)) { await responder(ayuda(persona, canal, propio)); return; }
    if (["/quien", "/quién", "quien", "quién"].includes(orden)) {
      const bot = propio ?? botActivo(persona, canal);
      await responder(bot ? `Estás hablando con ${canal === "whatsapp" ? `*${bot.name}*` : bot.name}.` : ayuda(persona, canal, null));
      return;
    }
    if (["/bots", "bots"].includes(orden)) {
      await responder(propio ? `Este contacto es solo de ${propio.name}. Para hablar con otros bots usa el contacto general de OpenBot.` : listaBots(persona, canal));
      return;
    }
    // Contestar a una tarjeta de permiso o pregunta pendiente.
    if (texto && !e.adjuntos?.length && await contestarTarjeta(persona, canal, contactoKey, texto)) return;
    // Elegir bot de la lista con un número.
    const eleccion = eligiendo.get(`${persona.id}|${canal}`);
    const numero = /^\s*(\d{1,2})\s*$/.exec(texto);
    if (!propio && eleccion && eleccion.expira > Date.now() && numero) {
      const bot = botPorId(eleccion.bots[Number(numero[1]) - 1] ?? "");
      if (bot && ajustes.bots[bot.id]?.[canal]) {
        eligiendo.delete(`${persona.id}|${canal}`);
        await responder(elegir(persona, canal, bot));
        return;
      }
    }
    let bot = propio ?? botActivo(persona, canal);
    let mensaje = texto;
    if (!propio && texto.startsWith("@")) {
      const mencion = botMencionado(texto, canal);
      if (!mencion) {
        await responder(`No encuentro ese bot. ${listaBots(persona, canal)}`);
        return;
      }
      bot = mencion.bot;
      mensaje = mencion.resto;
      if (bot.id !== persona.botActivo[canal]) {
        persona.botActivo[canal] = bot.id;
        guardar();
      }
      if (!mensaje && !e.adjuntos?.length) { await responder(elegir(persona, canal, bot)); return; }
    }
    if (!bot) { await responder(ayuda(persona, canal, null)); return; }
    if (["/nuevo", "nuevo", "/nueva"].includes(orden)) {
      const hilo = conversacionActual(persona, canal, bot, contacto, true);
      await responder(hilo ? `Conversación nueva con ${canal === "whatsapp" ? `*${bot.name}*` : bot.name}. ¿Qué necesitas?` : "No he podido abrir una conversación nueva. Inténtalo desde la app.");
      return;
    }
    const hilo = conversacionActual(persona, canal, bot, contacto);
    if (!hilo) { await responder(`No he podido abrir la conversación con ${bot.name}. Mira en la app si el bot sigue existiendo.`); return; }
    if (["/parar", "parar", "/stop", "stop", "para"].includes(orden)) {
      await deps.parar(bot.id, hilo).catch(() => undefined);
      dejarDeEscribir(hilo);
      await responder(`⏹️ ${bot.name} ha parado.`);
      return;
    }

    // Fotos, archivos y notas de voz.
    const partes: string[] = [];
    if (mensaje) partes.push(mensaje);
    let sinVoz = false;
    for (const a of e.adjuntos ?? []) {
      if (a.tipo === "audio") {
        const dicho = await transcribir(a, deps.config());
        if (dicho) { partes.push(`🎤 (nota de voz) ${dicho}`); continue; }
        sinVoz = true;
      }
      const etiqueta = await guardarAdjunto(a);
      if (etiqueta) partes.push(etiqueta);
    }
    if (sinVoz) partes.unshift("(Nota de voz adjunta sin transcribir.)");
    const final = partes.join("\n\n").trim();
    if (!final) return;
    if (sinVoz) await responder("ℹ️ No puedo pasar notas de voz a texto porque OpenBot no tiene un servicio de voz configurado (Ajustes → IA → Voz). Se la doy al bot como archivo; si no la entiende, escríbemelo.");

    const enviado = await deps.enviar({ botId: bot.id, threadId: hilo, texto: final, sendId: `${canal}:${e.mensajeId || randomUUID()}`, ...(remitenteDe(persona) ? { remitente: remitenteDe(persona)! } : {}) });
    if (!enviado.ok) { await responder(`⚠️ ${bot.name} no puede atenderte ahora: ${enviado.motivo}`); return; }
    if (enviado.enCola) await responder(`⏳ ${bot.name} está terminando otra cosa; lo verá justo después.`);
    empezarAEscribir(hilo, conector, e.chatId);
  }

  deps.alRecibirPrivado((e, conector) => { void recibirPrivado(e, conector).catch((error) => log(`canales: ${error instanceof Error ? error.message : String(error)}`)); });

  // ---------- contactos propios de Telegram ----------

  function arrancarPropio(botId: string): void {
    const viejo = propios.get(botId);
    void viejo?.parar();
    propios.delete(botId);
    if (!ajustes.contactoPropio[botId] || !tokenPropio(deps.dataDir, botId) || !botPorId(botId)) return;
    const conector = crearTelegram({
      token: () => tokenPropio(deps.dataDir, botId),
      soloPrivados: true,
      ordenes: ORDENES_TELEGRAM.filter((o) => o.command !== "bots"),
      alRecibir: (e) => { void recibirPrivado(e, conector, botId).catch((error) => log(`canales: ${error instanceof Error ? error.message : String(error)}`)); },
      log,
    });
    propios.set(botId, conector);
    conector.arrancar();
  }

  // ---------- Ajustes ----------

  function estado() {
    const tg = deps.conectores.telegram, wa = deps.conectores.whatsapp;
    const usados = new Set(Object.values(ajustes.conversaciones).map((c) => c.botId));
    return {
      conexiones: {
        whatsapp: { conectado: wa.estado().estado === "conectado", numero: wa.numero() },
        telegram: { conectado: tg.estado().estado === "conectado", usuario: tg.usuario() },
      },
      personasOpenbot: deps.personasOpenbot(),
      personas: ajustes.personas.map((p) => ({
        id: p.id, nombre: p.nombre, clave: p.clave ?? null,
        whatsapp: p.whatsapp ? `+${p.whatsapp}` : null, telegram: p.telegram ? true : false,
        avisos: p.avisos, avisosPor: p.avisosPor ?? null,
      })),
      bots: deps.bots().map((b) => {
        const propio = propios.get(b.id);
        return {
          ...b,
          whatsapp: ajustes.bots[b.id]?.whatsapp ?? false,
          telegram: ajustes.bots[b.id]?.telegram ?? false,
          conversacion: usados.has(b.id),
          contactoPropio: {
            activo: ajustes.contactoPropio[b.id] ?? false,
            tokenPuesto: Boolean(tokenPropio(deps.dataDir, b.id)),
            estado: propio?.estado().estado ?? "apagado",
            error: propio?.estado().error ?? null,
            usuario: propio?.usuario() ?? null,
          },
        };
      }),
    };
  }

  function nuevoCodigo(personaId: string) {
    for (const [c, v] of codigos) if (v.persona === personaId || v.expira < Date.now()) codigos.delete(c);
    let codigo = "";
    do codigo = `OB${String(randomInt(0, 1_000_000)).padStart(6, "0")}`; while (codigos.has(codigo));
    const expira = Date.now() + CODIGO_MS;
    codigos.set(codigo, { persona: personaId, expira });
    const numero = deps.conectores.whatsapp.numero();
    const usuario = deps.conectores.telegram.usuario();
    return {
      codigo, expira,
      whatsapp: numero ? `https://wa.me/${numero}?text=${codigo}` : null,
      telegram: usuario ? `https://t.me/${usuario}?start=${codigo}` : null,
      telegramPropios: deps.bots().flatMap((b) => {
        const u = propios.get(b.id)?.usuario();
        return u ? [{ bot: b.name, enlace: `https://t.me/${u}?start=${codigo}` }] : [];
      }),
    };
  }

  function crearPersona(nombre: string, claveOpenbot?: string) {
    const limpio = nombre.trim().slice(0, 60);
    if (!limpio) return { error: "Pon un nombre." };
    if (ajustes.personas.length >= 20) return { error: "Como mucho 20 personas." };
    const persona: Persona = { id: randomUUID().slice(0, 12), nombre: limpio, chat: {}, botActivo: {}, avisos: { ...AVISOS_POR_DEFECTO }, ...(claveOpenbot ? { clave: claveOpenbot } : {}) };
    ajustes.personas.push(persona);
    guardar();
    return { persona: persona.id, ...nuevoCodigo(persona.id) };
  }

  function cambiar(body: Record<string, unknown>): string | null {
    const bots = body.bots as Record<string, { whatsapp?: unknown; telegram?: unknown }> | undefined;
    if (bots && typeof bots === "object") {
      for (const [id, b] of Object.entries(bots)) {
        if (!botPorId(id) || !b || typeof b !== "object") continue;
        const actual = ajustes.bots[id] ?? { whatsapp: false, telegram: false };
        ajustes.bots[id] = { whatsapp: typeof b.whatsapp === "boolean" ? b.whatsapp : actual.whatsapp, telegram: typeof b.telegram === "boolean" ? b.telegram : actual.telegram };
      }
    }
    const p = body.persona as { id?: unknown; nombre?: unknown; avisos?: Partial<Record<keyof Avisos, unknown>>; avisosPor?: unknown; clave?: unknown } | undefined;
    if (p && typeof p === "object") {
      const persona = typeof p.id === "string" ? personaPorId(p.id) : undefined;
      if (!persona) return "Esa persona ya no está.";
      if (typeof p.nombre === "string" && p.nombre.trim()) persona.nombre = p.nombre.trim().slice(0, 60);
      if (p.avisos && typeof p.avisos === "object") for (const k of ["permisos", "terminadas", "fallos"] as const) if (typeof p.avisos[k] === "boolean") persona.avisos[k] = p.avisos[k] as boolean;
      if (p.avisosPor === "whatsapp" || p.avisosPor === "telegram") persona.avisosPor = p.avisosPor;
      if (p.avisosPor === null) delete persona.avisosPor;
      if (typeof p.clave === "string") { if (p.clave) persona.clave = p.clave.slice(0, 200); else delete persona.clave; }
    }
    const cp = body.contactoPropio as Record<string, unknown> | undefined;
    if (cp && typeof cp === "object") {
      for (const [id, on] of Object.entries(cp)) {
        if (!botPorId(id) || typeof on !== "boolean") continue;
        if (on && !tokenPropio(deps.dataDir, id)) return "Primero pon el token de ese contacto.";
        ajustes.contactoPropio[id] = on;
        arrancarPropio(id);
      }
    }
    guardar();
    return null;
  }

  function quitar(personaId: string, que: Canal | "todo"): void {
    const persona = personaPorId(personaId);
    if (!persona) return;
    if (que === "todo") {
      ajustes.personas = ajustes.personas.filter((p) => p !== persona);
      for (const [hilo, c] of Object.entries(ajustes.conversaciones)) if (c.persona === personaId) delete ajustes.conversaciones[hilo];
      for (const k of Object.keys(ajustes.actuales)) if (k.startsWith(`${personaId}|`)) delete ajustes.actuales[k];
    } else {
      if (que === "whatsapp") delete persona.whatsapp; else delete persona.telegram;
      delete persona.chat[que];
      for (const [hilo, c] of Object.entries(ajustes.conversaciones)) if (c.persona === personaId && c.canal === que) delete ajustes.conversaciones[hilo];
    }
    guardar();
  }

  async function ponerTokenPropio(botId: string, token: string | null): Promise<string | null> {
    if (!botPorId(botId)) return "Ese bot ya no existe.";
    if (token !== null && !TOKEN_TELEGRAM.test(token)) return "Ese token no tiene la forma de los de BotFather (números, dos puntos y letras).";
    if (token && token === tokenPropio(deps.dataDir, botId)) return null;
    // El mismo token no puede servir para dos contactos ni para el general.
    if (token && deps.bots().some((b) => b.id !== botId && tokenPropio(deps.dataDir, b.id) === token)) return "Ese token ya lo usa otro bot.";
    await propios.get(botId)?.parar();
    guardarTokenPropio(deps.dataDir, botId, token);
    ajustes.contactoPropio[botId] = Boolean(token);
    guardar();
    arrancarPropio(botId);
    return null;
  }

  function arrancar(): void {
    for (const id of Object.keys(ajustes.contactoPropio)) if (ajustes.contactoPropio[id]) arrancarPropio(id);
  }

  async function parar(): Promise<void> {
    desuscribir();
    for (const t of escribiendo.values()) clearInterval(t.timer);
    await Promise.all([...propios.values()].map((c) => c.parar()));
  }

  return { estado, cambiar, crearPersona, nuevoCodigo, quitar, ponerTokenPropio, aviso, arrancar, parar, personaPorId };
}

export type Canales = ReturnType<typeof crearCanales>;
export type { AjustesCanales };

/** Por qué no se pudo mandar un mensaje al bot, en palabras sencillas. */
export function motivoDeError(error: unknown): string {
  const e = error as { code?: unknown; status?: unknown; body?: { code?: unknown; error?: unknown }; message?: unknown };
  const code = String(e?.body?.code ?? e?.code ?? "");
  if (code === "thread_busy") return "está ocupado con esta conversación. Prueba en un momento.";
  if (code === "thread_limit") return "tiene demasiadas conversaciones a la vez. Prueba en un rato.";
  if (code === "spend_cap") return "se ha llegado al límite de gasto. Míralo en la app (Ajustes → Gasto).";
  if (/paused|held/i.test(code)) return "está en pausa. Reanúdalo desde la app.";
  if (code === "settling") return "está terminando lo anterior. Prueba en unos segundos.";
  if (e?.status === 404) return "ya no existe.";
  const texto = typeof e?.body?.error === "string" ? e.body.error : typeof e?.message === "string" ? e.message : "";
  return texto ? `algo ha fallado (${texto.slice(0, 200)}).` : "algo ha fallado. Mira la conversación en la app.";
}
