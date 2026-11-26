import DOMPurify from 'dompurify'
import { marked } from 'marked'

import type { BotStatus } from '../../shared/protocol'

marked.setOptions({ gfm: true, breaks: true })

/** Convierte el texto del bot (Markdown) en HTML seguro, con tablas y bloques de código cuidados. */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string

  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] })
    .replace(/<a /g, '<a target="_blank" rel="noreferrer" ')
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, '</table></div>')
    .replace(/<pre><code(?: class="language-([\w-]+)")?>/g, (_m, lang: string | undefined) =>
      `<div class="code"><div class="code-head"><span>${lang ?? 'texto'}</span><button type="button" class="code-copy">Copiar</button></div><pre><code>`)
    .replace(/<\/code><\/pre>/g, '</code></pre></div>')
}

/** Enlaces que aparecen en un texto (para la Biblioteca). */
export function extractLinks(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s)<>\]"']+/g) ?? [])]
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B` }
  if (bytes < 1024 * 1024) { return `${Math.round(bytes / 1024)} KB` }

  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
}

/** Hora corta para la lista de chats: "10:32", "Ayer", "lun", "3 nov". */
export function shortWhen(ts: number): string {
  const d = new Date(ts)
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 86_400_000)

  if (days <= 0) { return fmtTime.format(d) }
  if (days === 1) { return 'Ayer' }
  if (days < 7) { return new Intl.DateTimeFormat('es-ES', { weekday: 'short' }).format(d) }

  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(d)
}

const fmtTime = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' })
const fmtDay = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })

export const clock = (ts: number) => fmtTime.format(ts)

export function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86_400_000)

  if (d.toDateString() === today.toDateString()) { return 'Hoy' }
  if (d.toDateString() === yesterday.toDateString()) { return 'Ayer' }

  const s = fmtDay.format(d)

  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function ago(ts?: number): string {
  if (!ts) { return 'En espera' }

  const m = Math.round((Date.now() - ts) / 60_000)

  if (m < 2) { return 'Activo ahora' }
  if (m < 60) { return `Activo hace ${m} min` }

  const h = Math.round(m / 60)

  if (h < 24) { return `Activo hace ${h} h` }

  return 'En espera'
}

export function statusLine(s: BotStatus | undefined): string {
  if (!s) { return 'En espera' }
  if (s.state !== 'idle') { return s.label || 'Trabajando…' }

  return ago(s.lastActive)
}
