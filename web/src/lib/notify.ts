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

/** Enciende o apaga los avisos en este dispositivo. Devuelve cómo han quedado. */
export async function setNotify(on: boolean): Promise<boolean> {
  if (on && notifySupported() && Notification.permission !== 'granted') {
    await Notification.requestPermission().catch(() => undefined)
  }

  const ok = on && notifySupported() && Notification.permission === 'granted'

  try { localStorage.setItem(KEY, ok ? '1' : '0') } catch { /* sin almacenamiento */ }

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
  if (!state || document.visibilityState === 'visible' || !notifyOn()) { return }

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
