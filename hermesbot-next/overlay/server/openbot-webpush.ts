// OpenBot: avisos «push» al móvil y al ordenador, aunque OpenBot esté cerrada (como Grok Bot).
//
// La base solo avisaba con la pestaña abierta (src/lib/notify.ts) o con su app nativa de iPhone (phone-push.ts, que
// pasa por los servidores de sus autores). Aquí van los avisos estándar de la web (Web Push con claves VAPID): Chrome,
// Edge, Firefox y Safari en el Mac, y en el iPhone/iPad con OpenBot añadida a la pantalla de inicio (iOS 16.4 o más).
//
// - Cada aparato que activa los avisos guarda aquí su suscripción, con la sesión con la que entró y su persona.
// - Cuando el servidor emite un aviso (`notify`, el mismo que ve la bandeja), se manda a cada suscripción que lo vería con
//   la app abierta (la misma regla de visibilidad que el resto: `reaches`), y además:
//     · solo a su dueño: si en esa conversación ha escrito alguien, el aviso es de esa persona; si nadie ha escrito
//       (una tarea programada, un mensaje que el bot manda por su cuenta), es de todos los que ven el bot;
//     · no a quien tenga ese bot silenciado;
//     · no al aparato que en este momento está mirando justo esa conversación.
// - Todo se guarda en <datos>/openbot-webpush.json (claves del servidor incluidas). Nada sale a terceros salvo el propio
//   aviso cifrado hacia el servicio push del navegador (Apple, Google o Mozilla), que no puede leerlo.
import { createECDH, createHmac, createCipheriv, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface StoredSubscription extends PushSubscriptionJson {
  /** `session:<id>`: la sesión con la que se activó, para la regla de visibilidad. */
  key: string;
  /** La persona (clave de openbot-people) dueña del aparato. */
  person: string;
  /** Desde dónde se abrió OpenBot (https://…), que va como contacto en la firma VAPID. */
  origin: string;
  label: string;
  createdAt: number;
  updatedAt: number;
}

interface StoredFile {
  v: 1;
  vapid: { publicKey: string; privateKeyPem: string };
  subscriptions: StoredSubscription[];
  /** Bots silenciados por persona. */
  muted: Record<string, string[]>;
}

/** Lo que necesita del aviso de la base (shared/notification.ts). */
export interface PushNotice {
  kind: string;
  botId: string;
  botName: string;
  threadId: string;
  title: string;
  body: string;
  groupId?: string;
  routine?: true;
}

export interface OpenbotWebPushDeps {
  dataDir: string;
  /** La persona dueña de la conversación: quien escribió el último mensaje; null si nadie ha escrito. */
  threadPerson(threadId: string): string | null;
  /** El nombre que se enseña del bot, ya con el de la sala si viene de una. */
  roomName?(notice: PushNotice): string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

const MAX_SUBSCRIPTIONS = 200;
const VIEWING_FRESH_MS = 75_000;
const PREVIEW_MAX = 140;
const ENDPOINT = /^https:\/\/[^\s]{8,2000}$/;
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

const b64url = (data: Buffer) => data.toString("base64url");
const fromB64url = (text: string) => Buffer.from(text.replace(/=+$/, ""), "base64url");

/** Texto del aviso como en Grok Bot: título = el bot; si espera algo de ti, «X te está esperando». */
export function pushText(notice: PushNotice, room: string | null): { title: string; body: string } {
  const name = notice.botName?.trim() || "Tu bot";
  const where = room ? `${name} · ${room}` : name;
  const body = oneLine(notice.body);
  switch (notice.kind) {
    case "approval": case "question": case "sign-in": case "secret":
      return { title: `${where} te está esperando`, body: body || "Esperándote" };
    case "mention":
      return { title: `${where} te ha mencionado`, body: body || "Abre OpenBot para verlo" };
    case "routine-failed": case "turn-failed": case "incident":
      return { title: `${where}: algo ha fallado`, body: body || "Abre OpenBot para ver qué ha pasado" };
    case "spend":
      return { title: notice.title || "Gasto de este mes", body };
    default:
      return { title: where, body: body || "Abre OpenBot para ver lo que hizo" };
  }
}

function oneLine(text: string | undefined): string {
  const plain = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > PREVIEW_MAX ? `${plain.slice(0, PREVIEW_MAX - 1).trimEnd()}…` : plain;
}

/** Cifrado del contenido (RFC 8291, aes128gcm): solo el navegador del aparato puede leerlo. */
export function encryptPayload(sub: PushSubscriptionJson, plaintext: Buffer): Buffer {
  const uaPublic = fromB64url(sub.keys.p256dh);
  const authSecret = fromB64url(sub.keys.auth);
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]));
  const salt = randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: aes128gcm\0"), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from("Content-Encoding: nonce\0"), Buffer.from([1])])).subarray(0, 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

function generateVapid(): StoredFile["vapid"] {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const raw = Buffer.concat([Buffer.from([4]), fromB64url(jwk.x), fromB64url(jwk.y)]);
  return { publicKey: b64url(raw), privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString() };
}

function vapidHeader(vapid: StoredFile["vapid"], endpoint: string, subject: string, now: number): string {
  const aud = new URL(endpoint).origin;
  const head = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const signature = sign("sha256", Buffer.from(`${head}.${claims}`), { key: createPrivateKey(vapid.privateKeyPem), dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${claims}.${b64url(signature)}, k=${vapid.publicKey}`;
}

/** Contacto de la firma: Apple rechaza direcciones de localhost, así que en local va una genérica. */
function vapidSubject(origin: string): string {
  try {
    const url = new URL(origin);
    if (url.protocol === "https:" && !/(^|\.)localhost$|^127\.|^\[?::1\]?$/.test(url.hostname)) return url.origin;
  } catch { /* abajo */ }
  return "mailto:avisos@openbot.app";
}

export function validSubscription(value: unknown): PushSubscriptionJson | null {
  const sub = value as Partial<PushSubscriptionJson> | null;
  if (!sub || typeof sub.endpoint !== "string" || !ENDPOINT.test(sub.endpoint)) return null;
  const { p256dh, auth } = (sub.keys ?? {}) as { p256dh?: unknown; auth?: unknown };
  if (typeof p256dh !== "string" || typeof auth !== "string" || !B64URL.test(p256dh) || !B64URL.test(auth)) return null;
  if (fromB64url(p256dh).length !== 65 || fromB64url(auth).length < 16) return null;
  return { endpoint: sub.endpoint, keys: { p256dh, auth } };
}

export function createOpenbotWebPush(deps: OpenbotWebPushDeps) {
  const path = join(deps.dataDir, "openbot-webpush.json");
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.log(`[avisos] ${line}`));
  const doFetch = deps.fetchImpl ?? fetch;
  /** Qué conversación mira cada sesión ahora mismo (con la app delante). */
  const viewing = new Map<string, { threadId: string | null; at: number }>();

  const load = (): StoredFile => {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as StoredFile;
      if (parsed?.v === 1 && parsed.vapid?.publicKey && parsed.vapid.privateKeyPem) {
        createPublicKey(createPrivateKey(parsed.vapid.privateKeyPem));
        return { v: 1, vapid: parsed.vapid, subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [], muted: parsed.muted ?? {} };
      }
    } catch { /* se crea de nuevo */ }
    return { v: 1, vapid: generateVapid(), subscriptions: [], muted: {} };
  };
  let state = load();
  const save = () => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileAtomic(path, JSON.stringify(state, null, 2), { mode: 0o600 });
  };
  save();

  const deliver = async (sub: StoredSubscription, payload: Record<string, unknown>, urgency: "high" | "normal"): Promise<"sent" | "gone" | "failed"> => {
    try {
      const body = encryptPayload(sub, Buffer.from(JSON.stringify(payload)));
      const res = await doFetch(sub.endpoint, {
        method: "POST",
        headers: {
          Authorization: vapidHeader(state.vapid, sub.endpoint, vapidSubject(sub.origin), now()),
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: "86400",
          Urgency: urgency,
          // Avisos del mismo bot se sustituyen en el servicio push si el aparato estaba apagado.
          ...(typeof payload.tag === "string" ? { Topic: String(payload.tag).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}),
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 404 || res.status === 410) return "gone";
      if (!res.ok) {
        log(`el servicio push respondió ${res.status} (${new URL(sub.endpoint).host}): ${(await res.text().catch(() => "")).slice(0, 200)}`);
        return "failed";
      }
      return "sent";
    } catch (error) {
      log(`no se pudo enviar a ${new URL(sub.endpoint).host}: ${error instanceof Error ? error.message : String(error)}`);
      return "failed";
    }
  };

  const forgetEndpoints = (endpoints: Set<string>) => {
    if (endpoints.size === 0) return;
    state.subscriptions = state.subscriptions.filter((sub) => !endpoints.has(sub.endpoint));
    save();
  };

  const send = async (subs: StoredSubscription[], payload: (sub: StoredSubscription) => Record<string, unknown>, urgency: "high" | "normal") => {
    const results = await Promise.all(subs.map(async (sub) => [sub, await deliver(sub, payload(sub), urgency)] as const));
    forgetEndpoints(new Set(results.filter(([, outcome]) => outcome === "gone").map(([sub]) => sub.endpoint)));
    return results;
  };

  const lookingAt = (key: string, threadId: string) => {
    const seen = viewing.get(key);
    return seen !== undefined && seen.threadId === threadId && now() - seen.at < VIEWING_FRESH_MS;
  };

  return {
    publicKey: () => state.vapid.publicKey,

    status(key: string, person: string, endpoint?: string) {
      return {
        publicKey: state.vapid.publicKey,
        subscribed: endpoint ? state.subscriptions.some((sub) => sub.endpoint === endpoint) : state.subscriptions.some((sub) => sub.key === key),
        devices: state.subscriptions.filter((sub) => sub.person === person).length,
        muted: state.muted[person] ?? [],
      };
    },

    subscribe(key: string, person: string, sub: PushSubscriptionJson, origin: string, label: string) {
      const at = now();
      const previous = state.subscriptions.find((entry) => entry.endpoint === sub.endpoint);
      const entry: StoredSubscription = { ...sub, key, person, origin, label: label.slice(0, 80), createdAt: previous?.createdAt ?? at, updatedAt: at };
      state.subscriptions = [entry, ...state.subscriptions.filter((other) => other.endpoint !== sub.endpoint)].slice(0, MAX_SUBSCRIPTIONS);
      save();
    },

    unsubscribe(key: string, endpoint: string | undefined) {
      const before = state.subscriptions.length;
      state.subscriptions = state.subscriptions.filter((sub) => !(endpoint ? sub.endpoint === endpoint : sub.key === key));
      if (state.subscriptions.length !== before) save();
    },

    setMuted(person: string, botId: string, muted: boolean) {
      const list = new Set(state.muted[person] ?? []);
      if (muted) list.add(botId);
      else list.delete(botId);
      state.muted = { ...state.muted, [person]: [...list].slice(0, 500) };
      save();
      return state.muted[person];
    },

    /** La app dice qué conversación tiene delante (null: ninguna, o la app está en segundo plano). */
    viewing(key: string, threadId: string | null) {
      viewing.set(key, { threadId, at: now() });
    },

    forgetSession(sessionId: string) {
      viewing.delete(`session:${sessionId}`);
      const key = `session:${sessionId}`;
      if (state.subscriptions.some((sub) => sub.key === key)) {
        state.subscriptions = state.subscriptions.filter((sub) => sub.key !== key);
        save();
      }
    },

    /** Un aviso de la base: a quién le llega como push. `reaches`: si el aparato de esa sesión lo vería con la app
     * abierta (la misma regla que la base usa para su app de iPhone). */
    offer(notice: PushNotice, reaches: (key: string) => boolean) {
      if (!notice || typeof notice.botId !== "string" || typeof notice.threadId !== "string") return;
      if (state.subscriptions.length === 0) return;
      let owner: string | null = null;
      try { owner = deps.threadPerson(notice.threadId); } catch { owner = null; }
      const targets = state.subscriptions.filter((sub) => {
        if (owner && sub.person !== owner && notice.kind !== "spend") return false;
        if ((state.muted[sub.person] ?? []).includes(notice.botId) && notice.kind !== "spend") return false;
        if (lookingAt(sub.key, notice.threadId)) return false;
        try { return reaches(sub.key); } catch { return false; }
      });
      if (targets.length === 0) return;
      const room = deps.roomName?.(notice) ?? null;
      const { title, body } = pushText(notice, room);
      const asks = ["approval", "question", "sign-in", "secret", "mention"].includes(notice.kind);
      void send(targets, () => ({
        title, body,
        botId: notice.botId, threadId: notice.threadId, kind: notice.kind,
        tag: `openbot-${notice.groupId ?? notice.botId}`,
        icon: "/openbot-logo-192.png",
        url: `/?abrir=${encodeURIComponent(notice.threadId)}&bot=${encodeURIComponent(notice.botId)}`,
        at: now(),
      }), asks ? "high" : "normal");
    },

    /** El botón «Probar»: un aviso a los aparatos de esta sesión (o al que lo pidió). */
    async test(key: string, endpoint: string | undefined, notice: { botId: string; botName: string; threadId: string }) {
      const subs = state.subscriptions.filter((sub) => (endpoint ? sub.endpoint === endpoint : sub.key === key));
      if (subs.length === 0) return { sent: 0, failed: 0 };
      const results = await send(subs, () => ({
        title: notice.botName || "OpenBot",
        body: "¡Listo! Así te avisaré cuando termine algo o te necesite.",
        botId: notice.botId, threadId: notice.threadId, kind: "test",
        tag: `openbot-${notice.botId}`,
        icon: "/openbot-logo-192.png",
        url: `/?abrir=${encodeURIComponent(notice.threadId)}&bot=${encodeURIComponent(notice.botId)}`,
        at: now(),
        test: true,
      }), "high");
      return { sent: results.filter(([, outcome]) => outcome === "sent").length, failed: results.filter(([, outcome]) => outcome !== "sent").length };
    },
  };
}

export type OpenbotWebPush = ReturnType<typeof createOpenbotWebPush>;
