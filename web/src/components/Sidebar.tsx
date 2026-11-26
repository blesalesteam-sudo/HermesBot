import { useEffect, useMemo, useRef, useState } from 'react'

import type { User } from '../../shared/protocol'
import { shortWhen } from '../lib/format'
import type { ClientState } from '../lib/store'
import { Avatar } from './Avatar'
import { IconApps, IconLogout, IconMoon, IconSearch, IconSpark, IconSun, IconX } from './icons'

interface Props {
  state: ClientState
  activeId: string
  unread: Record<string, number>
  onSelect: (id: string) => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onLogout: () => void
  onOpenApps: () => void
  onOpenPalette: () => void
}

const clean = (text: string) => text.replace(/[*_>`#|]/g, '').replace(/\s+/g, ' ').trim()

function preview(state: ClientState, botId: string, users: User[]): string {
  const typing = (state.typing[botId] ?? []).filter(id => id !== state.me.id)

  if (typing.length) {
    return `${users.find(u => u.id === typing[0])?.name ?? 'Tu socio'} está escribiendo…`
  }

  if (state.requests.some(r => r.botId === botId)) { return 'Espera vuestra respuesta' }

  const st = state.status[botId]

  if (st && st.state !== 'idle') { return st.label || 'Trabajando…' }

  const list = state.messages[botId] ?? []
  const last = [...list].reverse().find(m => m.role !== 'notice' && (m.text.trim() || m.attachments?.length))

  if (!last) { return 'Sin mensajes todavía' }

  const plain = clean(last.text) || (last.attachments?.length === 1 ? 'Archivo adjunto' : `${last.attachments?.length} archivos adjuntos`)

  if (last.role === 'user') {
    return `${last.authorId === state.me.id ? 'Tú' : users.find(u => u.id === last.authorId)?.name ?? 'Socio'}: ${plain}`
  }

  return plain
}

export function Sidebar({ state, activeId, unread, onSelect, theme, onToggleTheme, onLogout, onOpenApps, onOpenPalette }: Props) {
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const q = query.trim().toLowerCase()
  const bots = useMemo(
    () => (q ? state.bots.filter(b => `${b.name} ${b.role}`.toLowerCase().includes(q)) : state.bots),
    [q, state.bots]
  )
  // Con texto en el buscador también se busca dentro de las conversaciones.
  const hits = useMemo(() => {
    if (q.length < 2) { return [] }

    const out: { botId: string; id: string; text: string; ts: number }[] = []

    for (const bot of state.bots) {
      for (const m of state.messages[bot.id] ?? []) {
        const plain = clean(m.text)
        const at = plain.toLowerCase().indexOf(q)

        if (m.role !== 'notice' && at !== -1) {
          out.push({ botId: bot.id, id: m.id, ts: m.ts, text: (at > 30 ? '…' : '') + plain.slice(Math.max(0, at - 30), at + 80) })
        }
      }
    }

    return out.sort((a, b) => b.ts - a.ts).slice(0, 12)
  }, [q, state.bots, state.messages])
  const partner = state.users.find(u => u.id !== state.me.id)
  const partnerOnline = partner ? state.online.includes(partner.id) : false

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) {
        e.preventDefault()
        input.current?.focus()
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <aside className="sidebar">
      <div className="side-brand">
        <span className="brand-dot" aria-hidden="true">h</span>
        <span className="brand-name">hermesBot</span>
        <button className="round-btn ghost" onClick={onOpenPalette} aria-label="Acciones rápidas" title="Acciones rápidas (Ctrl + K)"><IconSpark width={17} height={17} /></button>
      </div>

      <label className="search">
        <IconSearch width={15} height={15} />
        <input
          ref={input}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur() } }}
          placeholder="Buscar bots y mensajes"
          aria-label="Buscar bots y mensajes"
        />
        {query && <button type="button" className="search-x" onClick={() => setQuery('')} aria-label="Borrar búsqueda"><IconX width={13} height={13} /></button>}
      </label>

      <nav className="bot-list" aria-label="Bots del equipo">
        {!q && <div className="list-label">Vuestro equipo</div>}
        {bots.map(bot => {
          const st = state.status[bot.id]
          const busy = !!st && st.state !== 'idle'
          const list = state.messages[bot.id] ?? []
          const lastTs = list.length ? list[list.length - 1]!.ts : 0
          const pending = state.requests.some(r => r.botId === bot.id)
          const count = bot.id === activeId ? 0 : unread[bot.id] ?? 0

          return (
            <button
              key={bot.id}
              className={`bot-row${bot.id === activeId ? ' active' : ''}${count ? ' unread' : ''}`}
              onClick={() => onSelect(bot.id)}
              aria-current={bot.id === activeId ? 'page' : undefined}
              style={{ ['--bot' as string]: bot.color }}
            >
              <Avatar name={bot.name} color={bot.color} size={40} status={busy ? 'busy' : null} />
              <span className="bot-row-text">
                <span className="bot-row-top">
                  <span className="bot-row-name">{bot.name}</span>
                  {lastTs > 0 && <span className="bot-row-time">{shortWhen(lastTs)}</span>}
                </span>
                <span className="bot-row-bottom">
                  <span className={`bot-row-preview${busy ? ' busy' : ''}`}>{preview(state, bot.id, state.users)}</span>
                  {pending ? <span className="pending-dot" title="Espera vuestra respuesta" /> : count > 0 && <span className="badge">{count > 9 ? '9+' : count}</span>}
                </span>
              </span>
            </button>
          )
        })}
        {q && bots.length === 0 && hits.length === 0 && <p className="empty-hint">Nada coincide con “{query}”.</p>}
        {hits.length > 0 && (
          <>
            <div className="list-label">Mensajes</div>
            {hits.map(h => {
              const bot = state.bots.find(b => b.id === h.botId)!

              return (
                <button key={h.id} className="hit" onClick={() => { onSelect(h.botId); setQuery('') }}>
                  <span className="hit-top"><span>{bot.name}</span><span>{shortWhen(h.ts)}</span></span>
                  <span className="hit-text">{h.text}</span>
                </button>
              )
            })}
          </>
        )}
      </nav>

      <button className="apps-card" onClick={onOpenApps}>
        <span className="apps-card-icon"><IconApps width={17} height={17} /></span>
        <span className="apps-card-text">
          <span>Conectar aplicaciones</span>
          <span>WhatsApp, Telegram, Notion…</span>
        </span>
      </button>

      <div className="sidebar-foot">
        <div className="me-wrap">
          <button className="me" onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-haspopup="menu">
            <Avatar name={state.me.name} color={state.me.color} src={state.me.avatar} size={32} status="online" />
            <span className="me-text">
              <span className="me-name">{state.me.name}</span>
              {partner && <span className="me-sub"><i className={`presence${partnerOnline ? ' on' : ''}`} />{partner.name} {partnerOnline ? 'en línea' : 'desconectado'}</span>}
            </span>
          </button>
          {menu && (
            <>
              <div className="scrim" onClick={() => setMenu(false)} />
              <div className="menu up" role="menu">
                <button role="menuitem" onClick={() => { onToggleTheme(); setMenu(false) }}>
                  {theme === 'dark' ? <IconSun width={16} height={16} /> : <IconMoon width={16} height={16} />}
                  {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
                </button>
                <button role="menuitem" onClick={onLogout}><IconLogout width={16} height={16} /> Cerrar sesión</button>
              </div>
            </>
          )}
        </div>
        <button className="round-btn ghost" onClick={onToggleTheme} aria-label="Cambiar entre claro y oscuro" title="Claro u oscuro">
          {theme === 'dark' ? <IconSun width={17} height={17} /> : <IconMoon width={17} height={17} />}
        </button>
      </div>
    </aside>
  )
}
