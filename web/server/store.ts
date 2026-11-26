// Memoria propia de la web: qué conversación de Hermes corresponde a cada bot y el
// historial tal como lo ven los socios (con el autor de cada mensaje). Se guarda en un
// archivo dentro del volumen de Railway para que sobreviva a los reinicios.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Bot, ChatMessage, User, Widget } from '../shared/protocol.ts'
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

/** Conversación anterior de un bot, con su hilo de Hermes para poder retomarla. */
export interface ArchivedChat {
  id: string
  botId: string
  title: string
  ts: number
  sid?: string
  messages: ChatMessage[]
}

/** Archivo creado por el bot y guardado en la carpeta `files`. */
export interface StoredFile {
  name: string
  type: string
  size: number
}

interface Saved {
  users: StoredUser[]
  /** Bots creados o editados desde Ajustes. Si no hay, se usan los de fábrica. */
  bots?: Bot[]
  sessions: Record<string, string>
  messages: Record<string, ChatMessage[]>
  lastActive: Record<string, number>
  archive: ArchivedChat[]
  files: Record<string, StoredFile>
  /** Copia de seguridad diaria automática (activada salvo que se apague en Ajustes). */
  autoBackup?: boolean
  /** Bots incrustados en otras webs. */
  widgets?: Widget[]
}

const MAX_MESSAGES_PER_BOT = 600
export const STATE_FILE = 'hermesbot-state.json'
const file = join(config.dataDir, STATE_FILE)

function load(): Saved {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<Saved>

    return {
      users: data.users ?? [], bots: data.bots, sessions: data.sessions ?? {}, messages: data.messages ?? {},
      lastActive: data.lastActive ?? {}, archive: data.archive ?? [], files: data.files ?? {}, autoBackup: data.autoBackup, widgets: data.widgets
    }
  } catch {
    return { users: [], sessions: {}, messages: {}, lastActive: {}, archive: [], files: {} }
  }
}

let timer: NodeJS.Timeout | null = null

// Un mensaje que estaba a medias cuando el servicio se apagó ya no va a continuar.
function settle(data: Saved): Saved {
  for (const list of Object.values(data.messages)) {
    for (const m of list) {
      if (m.streaming) { m.streaming = false }
      for (const t of m.tools ?? []) {
        if (t.status === 'running') { t.status = 'done' }
      }
    }
  }

  return data
}

export const saved = settle(load())

/** Vuelve a leer el archivo de estado (tras restaurar una copia) sin cambiar el objeto compartido. */
export function reloadSaved() {
  if (timer) { clearTimeout(timer) }

  timer = null

  const fresh = settle(load())

  for (const key of Object.keys(saved)) { delete (saved as any)[key] }

  Object.assign(saved, fresh)
}

/** Guarda ahora mismo (antes de hacer una copia de seguridad). */
export function persistNow() {
  if (timer) { clearTimeout(timer) }

  timer = null
  write()
}

export function persist() {
  if (timer) { return }

  timer = setTimeout(() => {
    timer = null
    write()
  }, 800)
}

function write() {
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
}
