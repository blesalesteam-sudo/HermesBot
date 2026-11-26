// Avisos del navegador y botón de "instalar la app". Todo se guarda por dispositivo.
import type { ServerEvent } from '../../shared/protocol'
import type { ClientState } from './store'

const KEY = 'hb-notify'
const shown = new Set<string>()

const read = () => {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

export const notifySupported = () => typeof Notification !== 'undefined'
export const notifyBlocked = () => notifySupported() && Notification.permission === 'denied'
export const notifyOn = () => notifySupported() && Notification.permission === 'granted' && read()

declare const __DEMO__: boolean

const PUSH_KEY = 'hb-push'

/** Este dispositivo recibe los avisos también con la app cerrada. */
export const pushOn = () => {
  try { return notifyOn() && localStorage.getItem(PUSH_KEY) === '1' } catch { return false }
}

const fromBase64Url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

/** Apunta (o borra) este dispositivo para recibir avisos con la app cerrada. */
async function setPush(on: boolean): Promise<boolean> {
  let ok = false

  try {
    if (__DEMO__ || !('serviceWorker' in navigator) || !('PushManager' in window)) { return false }

    const reg = await navigator.serviceWorker.ready
    const current = await reg.pushManager.getSubscription()

    if (on) {
      const { key } = await (await fetch('/api/push/key')).json() as { key: string }
      const sub = current ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(key) })

      ok = (await fetch('/api/push/on', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub }) })).ok
    } else if (current) {
      await fetch('/api/push/off', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: current.endpoint }) })
      await current.unsubscribe()
    }
  } catch {
    ok = false
  } finally {
    try { localStorage.setItem(PUSH_KEY, ok ? '1' : '0') } catch { /* sin almacenamiento */ }
  }

  return ok
}

/** Al abrir la app: si los avisos están encendidos, se asegura de que este dispositivo sigue apuntado. */
export const refreshPush = () => (notifyOn() ? setPush(true) : Promise.resolve(false))

/** Enciende o apaga los avisos en este dispositivo. Devuelve cómo han quedado. */
export async function setNotify(on: boolean): Promise<boolean> {
  if (on && notifySupported() && Notification.permission !== 'granted') {
    await Notification.requestPermission().catch(() => undefined)
  }

  const ok = on && notifySupported() && Notification.permission === 'granted'

  try { localStorage.setItem(KEY, ok ? '1' : '0') } catch { /* sin almacenamiento */ }

  await setPush(ok)

  return ok
}

async function show(id: string, title: string, body: string) {
  if (shown.has(id)) { return }

  shown.add(id)

  const options = { body: body.replace(/[*_`#>|]/g, '').replace(/\s+/g, ' ').slice(0, 160), tag: id, icon: '/icon-192.png', badge: '/icon-192.png' }

  try {
    const reg = await navigator.serviceWorker?.getRegistration()

    if (reg) { return void await reg.showNotification(title, options) }

    const n = new Notification(title, options)

    n.onclick = () => { window.focus(); n.close() }
  } catch { /* el navegador no deja mostrar avisos ahora */ }
}

/** Avisa de lo que pasa mientras la app no está a la vista: respuestas, mensajes de otros y permisos. */
export function notifyFor(ev: ServerEvent, state: ClientState | null) {
  // Con los avisos de app cerrada activos, el aviso lo manda el servidor: aquí se repetiría.
  if (!state || document.visibilityState === 'visible' || !notifyOn() || pushOn()) { return }

  const botName = (id: string) => state.bots.find(b => b.id === id)?.name ?? 'hermesBot'

  if (ev.t === 'msg' && !ev.msg.streaming && ev.msg.text.trim()) {
    if (ev.msg.role === 'assistant') {
      void show(ev.msg.id, `${botName(ev.botId)} ha respondido`, ev.msg.text)
    } else if (ev.msg.role === 'user' && ev.msg.authorId !== state.me.id) {
      void show(ev.msg.id, `${state.users.find(u => u.id === ev.msg.authorId)?.name ?? 'Alguien'} escribió a ${botName(ev.botId)}`, ev.msg.text)
    }
  } else if (ev.t === 'req') {
    void show(ev.req.id, `${botName(ev.req.botId)} os necesita`, ev.req.kind === 'approval' ? 'Pide permiso para continuar.' : ev.req.question || 'Tiene una duda.')
  }
}

// ── Instalar como app

interface InstallEvent extends Event { prompt: () => Promise<void> }

let installEvent: InstallEvent | null = null
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    installEvent = e as InstallEvent
    listeners.forEach(fn => fn())
  })
  window.addEventListener('appinstalled', () => {
    installEvent = null
    listeners.forEach(fn => fn())
  })
}

export const canInstall = () => !!installEvent
export const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true
export const onInstallChange = (fn: () => void) => { listeners.add(fn); return () => void listeners.delete(fn) }
export const install = () => installEvent?.prompt().catch(() => undefined)
