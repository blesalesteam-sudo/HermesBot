// Acceso privado para los dos socios: usuario y contraseña, y una cookie firmada.
import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

import { type Account, config } from './config.ts'

const COOKIE = 'hb_session'
const MAX_AGE_S = 60 * 60 * 24 * 30

const sign = (value: string) => createHmac('sha256', config.sessionSecret).update(value).digest('base64url')

function same(a: string, b: string) {
  // Comparación en tiempo constante (se comparan huellas del mismo tamaño).
  const ha = scryptSync(a, 'hermesbot', 32)
  const hb = scryptSync(b, 'hermesbot', 32)

  return timingSafeEqual(ha, hb)
}

export function checkLogin(username: string, password: string): Account | null {
  const wanted = username.trim().toLowerCase()
  let found: Account | null = null

  for (const acc of config.accounts) {
    const ok = same(acc.password, password) && acc.username === wanted

    if (ok) { found = acc }
  }

  return found
}

export function sessionCookie(acc: Account): string {
  const body = `${acc.id}.${Math.floor(Date.now() / 1000) + MAX_AGE_S}`
  const secure = config.production ? '; Secure' : ''

  return `${COOKIE}=${body}.${sign(body)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`

export function accountFromRequest(req: IncomingMessage): Account | null {
  const raw = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith(`${COOKIE}=`))

  if (!raw) { return null }

  const [id, exp, mac] = raw.slice(COOKIE.length + 1).split('.')

  if (!id || !exp || !mac) { return null }

  const expected = sign(`${id}.${exp}`)

  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) { return null }
  if (Number(exp) < Date.now() / 1000) { return null }

  return config.accounts.find(a => a.id === id) ?? null
}

// Freno sencillo contra intentos de adivinar la contraseña: 8 intentos por minuto y por IP.
const attempts = new Map<string, number[]>()

export function tooManyAttempts(ip: string): boolean {
  const now = Date.now()
  const recent = (attempts.get(ip) ?? []).filter(t => now - t < 60_000)

  recent.push(now)
  attempts.set(ip, recent)

  return recent.length > 8
}
