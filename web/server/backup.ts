// Copias de seguridad: un único archivo con todo lo de la web (cuentas, bots, conversaciones,
// archivos) y la copia completa de Hermes (memoria, habilidades, rutinas, claves).
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'

import type { BackupInfo } from '../shared/protocol.ts'
import { config } from './config.ts'
import { FILES_DIR } from './files.ts'
import { persistNow, reloadSaved, saved, STATE_FILE } from './store.ts'

const run = promisify(execFile)
const HERMES_ZIP = 'hermes.zip'
const KEEP = 7
const MAX_RESTORE = 2 * 1024 * 1024 * 1024
const NAME = /^hermesbot-copia-[0-9A-Za-z-]+\.tar\.gz$/

const dir = () => join(config.dataDir, 'backups')
const auth = () => ({ authorization: `Bearer ${config.hermesToken}` })

export const backupPath = (name: string) => (NAME.test(name) && existsSync(join(dir(), name)) ? join(dir(), name) : null)

export function listBackups(): BackupInfo[] {
  try {
    return readdirSync(dir())
      .filter(n => NAME.test(n))
      .map(name => {
        const info = statSync(join(dir(), name))

        return { name, ts: info.mtimeMs, size: info.size }
      })
      .sort((a, b) => b.ts - a.ts)
  } catch {
    return []
  }
}

let making: Promise<{ file: string; name: string; hermes: boolean }> | null = null

/** Crea una copia ahora. `hermes` dice si se pudo incluir también la parte de Hermes. */
export function makeBackup(): Promise<{ file: string; name: string; hermes: boolean }> {
  making ??= (async () => {
    const stage = join(config.dataDir, `.copia-${randomUUID()}`)
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')
    const name = `hermesbot-copia-${stamp}.tar.gz`
    let hermes = false

    mkdirSync(stage, { recursive: true })
    mkdirSync(dir(), { recursive: true })
    mkdirSync(join(config.dataDir, FILES_DIR), { recursive: true })
    persistNow()

    try {
      if (config.hermesAdmin) {
        try {
          const res = await fetch(`${config.hermesAdmin}/admin/backup`, { headers: auth() })

          if (res.ok && res.body) {
            await pipeline(Readable.fromWeb(res.body as any), createWriteStream(join(stage, HERMES_ZIP)))
            hermes = true
          }
        } catch (error) {
          console.warn('[copias] no pude incluir la parte de Hermes:', (error as Error).message)
        }
      }

      const tmp = join(dir(), `.${name}.tmp`)

      await run('tar', ['-czf', tmp, '-C', config.dataDir, STATE_FILE, FILES_DIR, ...(hermes ? ['-C', stage, HERMES_ZIP] : [])])
      renameSync(tmp, join(dir(), name))

      for (const old of listBackups().slice(KEEP)) { rmSync(join(dir(), old.name), { force: true }) }

      return { file: join(dir(), name), name, hermes }
    } finally {
      rmSync(stage, { recursive: true, force: true })
      making = null
    }
  })()

  return making
}

/** Copia diaria: si está activada y la última tiene más de un día, hace una nueva. */
export function startAutoBackup() {
  const check = () => {
    if (saved.autoBackup === false || !saved.users.length) { return }

    const last = listBackups()[0]

    if (!last || Date.now() - last.ts > 24 * 3600_000) {
      makeBackup()
        .then(b => console.log('[copias] copia diaria hecha:', b.name, b.hermes ? '' : '(sin la parte de Hermes)'))
        .catch(error => console.error('[copias] la copia diaria falló:', (error as Error).message))
    }
  }

  setTimeout(check, 5 * 60_000)
  setInterval(check, 3600_000)
}

/** Restaura una copia subida desde Ajustes. Devuelve un texto de error o nada si fue bien. */
export async function restoreBackup(req: IncomingMessage): Promise<string | undefined> {
  const stage = join(config.dataDir, `.restaurar-${randomUUID()}`)
  const upload = join(stage, 'copia.tar.gz')

  mkdirSync(stage, { recursive: true })

  try {
    let size = 0

    req.on('data', chunk => {
      size += chunk.length

      if (size > MAX_RESTORE) { req.destroy(new Error('demasiado grande')) }
    })
    await pipeline(req, createWriteStream(upload))

    // Antes de tocar nada se comprueba que el archivo es una copia de hermesBot y no trae rutas raras.
    const { stdout } = await run('tar', ['-tzf', upload], { maxBuffer: 32 * 1024 * 1024 }).catch(() => ({ stdout: '' }))
    const entries = stdout.split('\n').filter(Boolean)
    const allowed = (e: string) => e === STATE_FILE || e === HERMES_ZIP || e === `${FILES_DIR}/` || /^files\/[0-9a-f-]{36}$/.test(e)

    if (!entries.includes(STATE_FILE) || !entries.every(allowed)) {
      return 'Ese archivo no es una copia de seguridad de hermesBot.'
    }

    const out = join(stage, 'contenido')

    mkdirSync(out)
    await run('tar', ['-xzf', upload, '-C', out, '--no-same-owner'])

    const state = JSON.parse(readFileSync(join(out, STATE_FILE), 'utf8'))

    if (!Array.isArray(state.users) || !state.users.some((u: any) => u?.admin && u?.hash)) {
      return 'La copia no contiene ninguna cuenta de administrador, así que no la aplico.'
    }

    // Por si acaso, se guarda una copia de lo que había justo antes de restaurar.
    await makeBackup().catch(() => undefined)

    if (existsSync(join(out, HERMES_ZIP)) && config.hermesAdmin) {
      const zip = join(out, HERMES_ZIP)
      const res = await fetch(`${config.hermesAdmin}/admin/restore`, {
        method: 'POST',
        headers: { ...auth(), 'content-type': 'application/zip', 'content-length': String(statSync(zip).size) },
        body: readFileSync(zip)
      })

      if (!res.ok) {
        const info = await res.json().catch(() => ({})) as { error?: string }

        return `Hermes no pudo restaurar su parte (${info.error || res.status}). No he cambiado nada.`
      }
    }

    rmSync(join(config.dataDir, FILES_DIR), { recursive: true, force: true })

    if (existsSync(join(out, FILES_DIR))) { renameSync(join(out, FILES_DIR), join(config.dataDir, FILES_DIR)) }

    renameSync(join(out, STATE_FILE), join(config.dataDir, STATE_FILE))
    reloadSaved()

    return undefined
  } catch (error) {
    console.error('[copias] restaurar falló:', error)

    return `No pude restaurar la copia (${(error as Error).message.slice(0, 160)}).`
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}
