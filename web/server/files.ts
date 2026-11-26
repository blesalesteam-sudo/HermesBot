// Archivos que crea el bot (imágenes, documentos…): se traen de Hermes una vez, se guardan
// junto al historial y se sirven solo a quien tiene la sesión abierta.
import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { basename, extname, join } from 'node:path'

import type { Attachment } from '../shared/protocol.ts'
import { config } from './config.ts'
import { persist, saved } from './store.ts'

export const FILES_DIR = 'files'

// Solo estos tipos se abren dentro del navegador; el resto se descarga.
const INLINE: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8'
}
const MAX_BYTES = 40 * 1024 * 1024

const dir = () => join(config.dataDir, FILES_DIR)

/** Rutas de archivos locales de Hermes que aparecen en una respuesta, y el texto ya sin las etiquetas internas. */
export function findBotFiles(text: string): { paths: string[]; clean: string } {
  const paths = new Set<string>()
  let clean = text.replace(/(^|\s)MEDIA:\s*((?:~|\/)[^\s`'")\]]+)/g, (_all, lead: string, path: string) => {
    paths.add(path)

    return lead
  })

  // Enlaces e imágenes en formato Markdown que apuntan a un archivo del propio Hermes.
  clean = clean.replace(/!?\[([^\]]*)\]\((?:file:\/\/|sandbox:)?((?:~|\/)[^)\s]+)\)/g, (_all, label: string, path: string) => {
    paths.add(path)

    return label
  })

  return { paths: [...paths].slice(0, 8), clean: clean.replace(/\n{3,}/g, '\n\n').trim() }
}

/** Trae un archivo de Hermes y lo guarda. Devuelve cómo enseñarlo en el chat, o nada si no se pudo. */
export async function fetchBotFile(path: string): Promise<Attachment | null> {
  if (!config.hermesAdmin) { return null }

  try {
    const res = await fetch(`${config.hermesAdmin}/admin/file?path=${encodeURIComponent(path)}`, {
      headers: { authorization: `Bearer ${config.hermesToken}` }
    })

    if (!res.ok) { return null }

    const data = Buffer.from(await res.arrayBuffer())

    if (!data.length || data.length > MAX_BYTES) { return null }

    const id = randomUUID()
    const name = basename(path).slice(0, 120) || 'archivo'
    const ext = extname(name).toLowerCase()

    mkdirSync(dir(), { recursive: true })
    writeFileSync(join(dir(), id), data)
    saved.files[id] = { name, type: INLINE[ext] ?? 'application/octet-stream', size: data.length }
    persist()

    return { id, name, kind: (INLINE[ext] ?? '').startsWith('image/') ? 'image' : 'file', size: data.length, url: `/files/${id}` }
  } catch (error) {
    console.warn('[archivos] no pude traer', path, (error as Error).message)

    return null
  }
}

export function serveBotFile(res: ServerResponse, id: string) {
  const meta = saved.files[id]
  const file = join(dir(), id)

  if (!meta || !/^[0-9a-f-]{36}$/.test(id) || !existsSync(file)) {
    res.writeHead(404)

    return void res.end()
  }

  const inline = meta.type !== 'application/octet-stream'

  res.writeHead(200, {
    'content-type': meta.type,
    'content-length': meta.size,
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
    'cache-control': 'private, max-age=86400',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox"
  })
  createReadStream(file).pipe(res)
}
