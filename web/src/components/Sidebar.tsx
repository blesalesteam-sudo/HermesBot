import { useEffect, useMemo, useRef, useState } from 'react'

import type { User } from '../../shared/protocol'
import { shortWhen } from '../lib/format'
import type { ClientState } from '../lib/store'
import { Avatar } from './Avatar'
import { IconApps, IconLogout, IconMoon, IconSearch, IconSpark, IconSun } from './icons'

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

  const plain = clean(last.text) || 'Archivo adjunto'

  if (last.role === 'user' && last.authorId !== state.me.id) {
    return `${users.find(u => u.id === last.authorId)?.name ?? 'Socio'}: ${plain}`
  }

  return plain
}

export function Sidebar({ state, activeId, unread, onSelect, theme, onToggleTheme, onLogout, onOpenApps, onOpenPalette }: Props) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [menu, setMenu] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const [featured, ...rest] = state.bots
  const bots = useMemo(() => {
    const q = query.trim().toLowerCase()

    return q ? state.bots.filter(b => `${b.name} ${b.role}`.toLowerCase().includes(q)) : rest
  }, [query, state.bots]) // eslint-disable-line react-hooks/exhaustive-deps
  // Con texto en el buscador también se busca dentro de las conversaciones.
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase()

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
  }, [query, state.bots, state.messages])
  const partner = state.users.find(u => u.id !== state.me.id)
  const partnerOnline = partner ? state.online.includes(partner.id) : false

  useEffect(() => {
    if (searching) { input.current?.focus() }
  }, [searching])

  return (
    <aside className="sidebar">
      <div className="side-top">
        {searching ? (
          <label className="search">
            <IconSearch width={16} height={16} />
            <input
              ref={input}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); setSearching(false) } }}
              onBlur={() => { if (!query) { setSearching(false) } }}
              placeholder="Buscar bots y mensajes"
              aria-label="Buscar bots y mensajes"
            />
          </label>
        ) : (
          <span className="side-top-spacer" />
        )}
        {!searching && (
          <button className="round-btn" onClick={() => setSearching(true)} aria-label="Buscar" title="Buscar"><IconSearch width={17} height={17} /></button>
        )}
        <button className="round-btn" onClick={onOpenPalette} aria-label="Acciones rápidas" title="Acciones rápidas (Ctrl + K)"><IconSpark width={17} height={17} /></button>
      </div>

      {!query && featured && (
        <button className={`featured${featured.id === activeId ? ' active' : ''}`} onClick={() => onSelect(featured.id)}>
          <Avatar name={featured.name} color={featured.color} size={56} status={state.status[featured.id]?.state !== 'idle' && state.status[featured.id] ? 'busy' : null} />
          <span>{featured.name}</span>
          {featured.id !== activeId && (unread[featured.id] ?? 0) > 0 && <span className="badge on-featured">{unread[featured.id]! > 9 ? '9+' : unread[featured.id]}</span>}
        </button>
      )}

      <nav className="bot-list" aria-label="Bots del equipo">
        {bots.map(bot => {
          const st = state.status[bot.id]
          const busy = !!st && st.state !== 'idle'
          const list = state.messages[bot.id] ?? []
          const lastTs = list.length ? list[list.length - 1]!.ts : 0
          const count = bot.id === activeId ? 0 : unread[bot.id] ?? 0
          const pending = state.requests.some(r => r.botId === bot.id)

          return (
            <button
              key={bot.id}
              className={`bot-row${bot.id === activeId ? ' active' : ''}${count ? ' unread' : ''}`}
              style={{ ['--bot' as string]: bot.color }}
              onClick={() => onSelect(bot.id)}
              aria-current={bot.id === activeId ? 'page' : undefined}
            >
              <Avatar name={bot.name} color={bot.color} size={34} status={busy ? 'busy' : null} />
              <span className="bot-row-text">
                <span className="bot-row-top">
                  <span className="bot-row-name">{bot.name}</span>
                  {lastTs > 0 && <span className="bot-row-time">{shortWhen(lastTs)}</span>}
                </span>
                <span className={`bot-row-preview${busy ? ' busy' : ''}`}>{preview(state, bot.id, state.users)}</span>
              </span>
              {pending ? <span className="pending-dot" title="Espera vuestra respuesta" /> : count > 0 && <span className="badge">{count > 9 ? '9+' : count}</span>}
            </button>
          )
        })}
        {bots.length === 0 && hits.length === 0 && <p className="empty-hint">Nada coincide con “{query}”.</p>}
        {hits.length > 0 && (
          <>
            <div className="list-label">Mensajes</div>
            {hits.map(h => (
              <button key={h.id} className="hit" onClick={() => { onSelect(h.botId); setQuery(''); setSearching(false) }}>
                <span className="hit-top"><span>{state.bots.find(b => b.id === h.botId)?.name}</span><span>{shortWhen(h.ts)}</span></span>
                <span className="hit-text">{h.text}</span>
              </button>
            ))}
          </>
        )}
      </nav>

      <div className="sidebar-foot">
        <div className="me-wrap">
          <button className="me" onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-haspopup="menu">
            <Avatar name={state.me.name} color={state.me.color} src={state.me.avatar} size={30} />
            <span className="me-text">
              <span className="me-name">{state.me.name}</span>
              {partner && <span className="me-sub"><i className={`presence${partnerOnline ? ' on' : ''}`} />{partner.name} {partnerOnline ? 'conectado' : 'desconectado'}</span>}
            </span>
          </button>
          {menu && (
            <div className="menu up" role="menu" onMouseLeave={() => setMenu(false)}>
              <button role="menuitem" onClick={() => { onToggleTheme(); setMenu(false) }}>
                {theme === 'dark' ? <IconSun width={16} height={16} /> : <IconMoon width={16} height={16} />}
                {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
              </button>
              <button role="menuitem" onClick={onLogout}><IconLogout width={16} height={16} /> Cerrar sesión</button>
            </div>
          )}
        </div>
        <button className="round-btn" onClick={onOpenApps} aria-label="Conectar aplicaciones" title="Conectar aplicaciones"><IconApps width={17} height={17} /></button>
      </div>
    </aside>
  )
}
