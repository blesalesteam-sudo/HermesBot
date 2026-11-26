// Avisos con la app cerrada ("push"): cada dispositivo que los activa en Ajustes queda apuntado
// aquí, y la web le manda el aviso a través del servicio de avisos de su navegador.
// Las llaves que hacen falta se crean solas la primera vez y se guardan con el resto de datos.
import webpush from 'web-push'

import { config } from './config.ts'
import { persist, saved } from './store.ts'

export interface PushDevice {
  userId: string
  endpoint: string
  keys: { p256dh: string; auth: string }
  ts: number
}

const MAX_DEVICES_PER_USER = 8

function keys() {
  if (!saved.push) {
    saved.push = { ...webpush.generateVAPIDKeys(), devices: [] }
    persist()
  }

  return saved.push
}

export const pushPublicKey = () => keys().publicKey

export function addPushDevice(userId: string, sub: any, origin: string): boolean {
  const endpoint = String(sub?.endpoint ?? '')
  const p256dh = String(sub?.keys?.p256dh ?? '')
  const auth = String(sub?.keys?.auth ?? '')

  if (!/^https:\/\/[^\s]{10,1000}$/.test(endpoint) || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) { return false }

  const store = keys()

  if (/^https:\/\//.test(origin)) { store.subject = origin }

  const mine = store.devices.filter(d => d.userId === userId && d.endpoint !== endpoint).slice(-(MAX_DEVICES_PER_USER - 1))

  store.devices = [...store.devices.filter(d => d.userId !== userId && d.endpoint !== endpoint), ...mine, { userId, endpoint, keys: { p256dh, auth }, ts: Date.now() }]
  persist()

  return true
}

export function removePushDevice(endpoint: string) {
  const store = keys()
  const before = store.devices.length

  store.devices = store.devices.filter(d => d.endpoint !== endpoint)

  if (store.devices.length !== before) { persist() }
}

export interface PushNote {
  title: string
  body: string
  /** Avisos con la misma etiqueta se sustituyen en vez de acumularse. */
  tag: string
  botId: string
}

/** Manda un aviso a los dispositivos de las personas indicadas. Los que ya no existen se olvidan solos. */
export async function sendPush(userIds: string[], note: PushNote) {
  const store = saved.push

  if (!store?.devices.length || !userIds.length) { return }

  const payload = JSON.stringify({ ...note, body: note.body.replace(/[*_`#>|]/g, '').replace(/\s+/g, ' ').slice(0, 160) })
  const options = {
    TTL: 3600,
    urgency: 'high' as const,
    vapidDetails: { subject: config.publicUrl || store.subject || 'https://hermesbot.app', publicKey: store.publicKey, privateKey: store.privateKey }
  }

  await Promise.all(store.devices.filter(d => userIds.includes(d.userId)).map(async d => {
    try {
      await webpush.sendNotification({ endpoint: d.endpoint, keys: d.keys }, payload, options)
    } catch (error) {
      const code = (error as { statusCode?: number }).statusCode

      if (code === 404 || code === 410) {
        removePushDevice(d.endpoint)
      } else {
        console.warn('[avisos] no se pudo entregar un aviso:', code ?? (error as Error).message)
      }
    }
  }))
}
