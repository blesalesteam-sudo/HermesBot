// Memoria propia de la web: qué conversación de Hermes corresponde a cada bot y el
// historial tal como lo ven los socios (con el autor de cada mensaje). Se guarda en un
// archivo dentro del volumen de Railway para que sobreviva a los reinicios.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Bot, ChatMessage, User } from '../shared/protocol.ts'
import { config } from './config.ts'

/** Cuenta guardada: los datos visibles y la huella de la contraseña (nunca la contraseña). */
export interface StoredUser extends User {
  username: string
  admin: boolean
  salt: string
  hash: string
  /** Sube al cambiar la contraseña, para cerrar las sesiones antiguas. */
  ver: number
}

interface Saved {
  users: StoredUser[]
  /** Bots creados o editados desde Ajustes. Si no hay, se usan los de fábrica. */
  bots?: Bot[]
  sessions: Record<string, string>
  messages: Record<string, ChatMessage[]>
  lastActive: Record<string, number>
}

const MAX_MESSAGES_PER_BOT = 600
const file = join(config.dataDir, 'hermesbot-state.json')

function load(): Saved {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<Saved>

    return { users: data.users ?? [], bots: data.bots, sessions: data.sessions ?? {}, messages: data.messages ?? {}, lastActive: data.lastActive ?? {} }
  } catch {
    return { users: [], sessions: {}, messages: {}, lastActive: {} }
  }
}

export const saved = load()

// Un mensaje que estaba a medias cuando el servicio se apagó ya no va a continuar.
for (const list of Object.values(saved.messages)) {
  for (const m of list) {
    if (m.streaming) { m.streaming = false }
    for (const t of m.tools ?? []) {
      if (t.status === 'running') { t.status = 'done' }
    }
  }
}

let timer: NodeJS.Timeout | null = null

export function persist() {
  if (timer) { return }

  timer = setTimeout(() => {
    timer = null

    try {
      mkdirSync(config.dataDir, { recursive: true })

      for (const [bot, list] of Object.entries(saved.messages)) {
        if (list.length > MAX_MESSAGES_PER_BOT) { saved.messages[bot] = list.slice(-MAX_MESSAGES_PER_BOT) }
      }

      writeFileSync(`${file}.tmp`, JSON.stringify(saved))
      renameSync(`${file}.tmp`, file)
    } catch (error) {
      console.error('[store] no pude guardar el estado:', (error as Error).message)
    }
  }, 800)
}
