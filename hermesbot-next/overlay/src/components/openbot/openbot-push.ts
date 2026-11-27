// OpenBot: los avisos push de este aparato (server/routes/openbot-push.ts y public/openbot-sw.js).
// - activar(): pide permiso (siempre tras un toque: Safari y el iPhone no lo dejan de otra forma), registra el
//   trabajador y guarda la suscripción en el servidor.
// - Al abrir la app, si ya estaban activados, renueva la suscripción en silencio (por si cambió la sesión).
// - Dice al servidor qué conversación tiene delante, para no avisar de lo que ya estás mirando.
// - Al tocar un aviso con la app abierta, el trabajador manda un mensaje y la app abre esa conversación.
import { useEffect, useState } from "react";
import { call } from "./people-api";

const SW_URL = "/openbot-sw.js";
const ON_KEY = "openbot.avisos";

export type PushSupport =
  | "ok"
  /** iPhone/iPad en Safari normal: hay que añadir OpenBot a la pantalla de inicio. */
  | "ios-install"
  /** iOS anterior a 16.4, u otro navegador sin avisos. */
  | "unsupported";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  const capable = "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
  if (isIos() && !isStandalone()) return "ios-install";
  return capable ? "ok" : "unsupported";
}

/** Si este aparato tiene los avisos push encendidos (para no repetir el aviso que enseña la propia página). */
export function pushOnHere(): boolean {
  try { return localStorage.getItem(ON_KEY) === "1" && typeof Notification !== "undefined" && Notification.permission === "granted"; } catch { return false; }
}
function rememberOn(on: boolean) {
  try { on ? localStorage.setItem(ON_KEY, "1") : localStorage.removeItem(ON_KEY); } catch { /* sin almacenamiento */ }
  for (const listener of listeners) listener();
}
const listeners = new Set<() => void>();

function keyBytes(base64url: string): Uint8Array {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing?.active?.scriptURL.endsWith(SW_URL)) return existing;
  await navigator.serviceWorker.register(SW_URL, { scope: "/" });
  return navigator.serviceWorker.ready;
}

async function subscription(reg: ServiceWorkerRegistration, publicKey: string): Promise<PushSubscription> {
  const current = await reg.pushManager.getSubscription();
  if (current) {
    const key = current.options?.applicationServerKey;
    const same = key && btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") === publicKey;
    if (same !== false) return current;
    await current.unsubscribe().catch(() => undefined);
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource });
}

export interface PushStatus { publicKey: string; subscribed: boolean; devices: number; muted: string[] }

export async function readStatus(): Promise<PushStatus | null> {
  let endpoint = "";
  try { endpoint = (await (await navigator.serviceWorker?.getRegistration("/"))?.pushManager.getSubscription())?.endpoint ?? ""; } catch { /* nada */ }
  const res = await call<PushStatus>(`/api/openbot/push${endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : ""}`);
  return res.ok ? res.data : null;
}

/** Desde el toque del interruptor. Devuelve un texto de error para enseñar, o null si quedó activado. */
export async function activar(): Promise<string | null> {
  const support = pushSupport();
  if (support === "ios-install") return "En el iPhone, primero añade OpenBot a la pantalla de inicio y ábrela desde allí.";
  if (support === "unsupported") return "Este navegador no puede recibir avisos.";
  // Primero el permiso, en el mismo toque (Safari lo exige).
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return permission === "denied" ? "bloqueado" : "No has dado permiso.";
  try {
    const status = await call<PushStatus>("/api/openbot/push");
    if (!status.ok) return status.error;
    const reg = await registration();
    const sub = await subscription(reg, status.data.publicKey);
    const saved = await call("/api/openbot/push", "PUT", { subscription: sub.toJSON() });
    if (!saved.ok) return saved.error;
    rememberOn(true);
    return null;
  } catch (error) {
    return error instanceof Error ? `No se pudieron activar: ${error.message}` : "No se pudieron activar.";
  }
}

export async function desactivar(): Promise<void> {
  try {
    const sub = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
    await call("/api/openbot/push", "DELETE", { endpoint: sub?.endpoint });
    await sub?.unsubscribe();
  } catch { /* se queda apagado igualmente */ }
  rememberOn(false);
}

export async function probar(botId: string): Promise<string | null> {
  let endpoint: string | undefined;
  try { endpoint = (await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription())?.endpoint; } catch { /* nada */ }
  const res = await call<{ sent: number; failed: number }>("/api/openbot/push/test", "POST", { botId, endpoint });
  if (!res.ok) return res.error;
  if (res.data.sent === 0) return "No llegó a este aparato. Apaga y vuelve a encender los avisos.";
  return null;
}

export async function silenciarBot(botId: string, muted: boolean): Promise<string[] | null> {
  const res = await call<{ muted: string[] }>("/api/openbot/push/bot", "PUT", { botId, muted });
  return res.ok ? res.data.muted : null;
}

export function usePushOn(): boolean {
  const [on, setOn] = useState(pushOnHere);
  useEffect(() => {
    const update = () => setOn(pushOnHere());
    listeners.add(update);
    window.addEventListener("focus", update);
    return () => { listeners.delete(update); window.removeEventListener("focus", update); };
  }, []);
  return on;
}

// ——— Lo que hace la app mientras está abierta ———

let viewingNow: string | null | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;

function sendViewing(threadId: string | null) {
  if (!pushOnHere()) return;
  try {
    void fetch("/api/openbot/push/viewing", {
      method: "POST", credentials: "same-origin", keepalive: true,
      headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId }),
    }).catch(() => undefined);
  } catch { /* nada */ }
}

function clearShown(botId: string | null) {
  if (!botId || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.getRegistration("/").then((reg) => reg?.active?.postMessage({ type: "openbot:visto", botId })).catch(() => undefined);
}

/** La store la llama cada vez que cambia la conversación que se ve (null: ninguna). */
export function reportViewing(threadId: string | null, botId: string | null) {
  const visible = document.visibilityState === "visible";
  const now = visible ? threadId : null;
  lastThread = threadId; lastBot = botId;
  if (visible && botId) clearShown(botId);
  if (now === viewingNow) return;
  viewingNow = now;
  sendViewing(now);
}

let started = false;
let lastThread: string | null = null;
let lastBot: string | null = null;

/** Una vez al arrancar la app: renovar la suscripción, escuchar al trabajador y abrir el chat del enlace. */
export function startPush(open: (target: { botId: string; threadId: string }) => void, current: () => { threadId: string | null; botId: string | null }) {
  if (started || typeof window === "undefined") return;
  started = true;
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      const msg = event.data as { type?: string; botId?: string; threadId?: string } | null;
      if (msg?.type === "openbot:abrir" && msg.threadId && msg.botId) open({ botId: msg.botId, threadId: msg.threadId });
    });
    if (pushOnHere()) {
      void (async () => {
        try {
          const status = await call<PushStatus>("/api/openbot/push");
          if (!status.ok) return;
          const reg = await registration();
          const sub = await subscription(reg, status.data.publicKey);
          await call("/api/openbot/push", "PUT", { subscription: sub.toJSON() });
        } catch { /* se intentará la próxima vez */ }
      })();
    }
  }
  const tick = () => {
    const { threadId, botId } = current();
    reportViewing(threadId, botId);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { viewingNow = undefined; tick(); }
    else { viewingNow = null; sendViewing(null); }
  });
  window.addEventListener("pagehide", () => sendViewing(null));
  heartbeat = setInterval(() => { if (document.visibilityState === "visible" && lastThread) { sendViewing(lastThread); if (lastBot) clearShown(lastBot); } }, 45_000);
  void heartbeat;
}

/** El enlace de un aviso (/?abrir=<conversación>&bot=<bot>), una sola vez cuando ya están los bots. */
export function takeLinkTarget(): { botId: string; threadId: string } | null {
  try {
    const url = new URL(window.location.href);
    const threadId = url.searchParams.get("abrir"), botId = url.searchParams.get("bot");
    if (!threadId || !botId) return null;
    url.searchParams.delete("abrir");
    url.searchParams.delete("bot");
    window.history.replaceState(window.history.state, "", url.pathname + (url.search === "?" ? "" : url.search) + url.hash);
    return { botId, threadId };
  } catch {
    return null;
  }
}
