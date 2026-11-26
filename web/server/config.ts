// Toda la configuración sale de variables de entorno (en Railway: pestaña "Variables").
import { randomBytes } from 'node:crypto'

import { DEFAULT_BOTS, USER_COLORS } from '../shared/defaults.ts'
import type { Bot, User } from '../shared/protocol.ts'

export interface Account extends User {
  username: string
  password: string
}

const env = process.env

function account(n: number): Account | null {
  const username = env[`SOCIO${n}_USUARIO`]?.trim()
  const password = env[`SOCIO${n}_CLAVE`] ?? ''

  if (!username || !password) {
    return null
  }

  return {
    id: `socio-${n}`,
    username: username.toLowerCase(),
    password,
    name: env[`SOCIO${n}_NOMBRE`]?.trim() || username,
    avatar: env[`SOCIO${n}_FOTO`]?.trim() || undefined,
    color: USER_COLORS[(n - 1) % USER_COLORS.length]!
  }
}

function bots(): Bot[] {
  // Opcional: BOTS_JSON permite cambiar la lista de bots sin tocar el código.
  if (env.BOTS_JSON) {
    try {
      const parsed = JSON.parse(env.BOTS_JSON) as Bot[]

      if (Array.isArray(parsed) && parsed.every(b => b.id && b.name)) {
        return parsed.map((b, i) => ({ ...b, role: b.role ?? '', color: b.color ?? DEFAULT_BOTS[i % DEFAULT_BOTS.length]!.color }))
      }
    } catch {
      console.warn('[config] BOTS_JSON no es válido; uso los bots por defecto')
    }
  }

  return DEFAULT_BOTS
}

const sessionSecret = env.SESSION_SECRET || ''

if (!sessionSecret) {
  console.warn('[config] Falta SESSION_SECRET: las sesiones se cerrarán cada vez que el servicio se reinicie.')
}

export const config = {
  port: Number(env.PORT || 3000),
  accounts: [account(1), account(2)].filter((a): a is Account => a !== null),
  bots: bots(),
  sessionSecret: sessionSecret || randomBytes(32).toString('hex'),
  hermesUrl: env.HERMES_CORE_URL || '',
  hermesToken: env.HERMES_INTERNAL_TOKEN || '',
  /** Dirección de las órdenes internas del puente de hermes-core (modelo, archivos, copias). */
  hermesAdmin: (env.HERMES_CORE_URL || '').replace(/^ws/, 'http').replace(/\/+$/, '').replace(/\/gateway$/, ''),
  /** Código de estreno: sin él nadie puede crear la primera cuenta. */
  setupCode: (env.SETUP_CODE || '').trim() || randomBytes(4).toString('hex'),
  setupCodeFromEnv: !!(env.SETUP_CODE || '').trim(),
  dataDir: env.DATA_DIR || './data',
  /** Dirección pública de la web (Railway la da sola). Solo se usa para firmar los avisos. */
  publicUrl: env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '',
  production: env.NODE_ENV === 'production'
}
