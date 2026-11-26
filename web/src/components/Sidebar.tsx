import { useEffect, useMemo, useRef, useState } from 'react'

import type { User } from '../../shared/protocol'
import type { ClientState } from '../lib/store'
import { Avatar } from './Avatar'
import { IconApps, IconLogout, IconMoon, IconPlus, IconSearch, IconSun } from './icons'

interface Props {
  state: ClientState
  activeId: string
  onSelect: (id: string) => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onLogout: () => void
  onOpenApps: () => void
}

function preview(state: ClientState, botId: string, users: User[]): string {
  const typing = (state.typing[botId] ?? []).filter(id => id !== state.me.id)

  if (typing.length) {
    return `${users.find(u => u.id === typing[0])?.name ?? 'Tu socio'} está escribiendo…`
  }

  if (state.requests.some(r => r.botId === botId)) { return 'Espera vuestra respuesta' }

  const st = state.status[botId]

  if (st && st.state !== 'idle') { return st.label || 'Trabajando…' }

  const list = state.messages[botId] ?? []
  const last = [...list].reverse().find(m => m.text.trim())

  if (!last) { return 'Sin mensajes todavía' }

  const plain = last.text.replace(/[*_>`#]/g, '').replace(/\s+/g, ' ').trim()

  if (last.role === 'user' && last.authorId !== state.me.id) {
    return `${users.find(u => u.id === last.authorId)?.name ?? 'Socio'}: ${plain}`
  }

  return plain
}

export function Sidebar({ state, activeId, onSelect, theme, onToggleTheme, onLogout, onOpenApps }: Props) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [menu, setMenu] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const [featured, ...rest] = state.bots
  const bots = useMemo(() => {
    const q = query.trim().toLowerCase()

    return q ? state.bots.filter(b => `${b.name} ${b.role}`.toLowerCase().includes(q)) : rest
  }, [query, state.bots]) // eslint-disable-line react-hooks/exhaustive-deps
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
              placeholder="Buscar"
              aria-label="Buscar bots"
            />
          </label>
        ) : (
          <span className="side-top-spacer" />
        )}
        {!searching && (
          <button className="round-btn" onClick={() => setSearching(true)} aria-label="Buscar" title="Buscar"><IconSearch width={17} height={17} /></button>
        )}
        <button className="round-btn" aria-label="Nuevo bot" title="Nuevo bot (próximamente)" disabled><IconPlus width={17} height={17} /></button>
      </div>

      {!query && featured && (
        <button className={`featured${featured.id === activeId ? ' active' : ''}`} onClick={() => onSelect(featured.id)}>
          <Avatar name={featured.name} color={featured.color} size={56} status={state.status[featured.id]?.state !== 'idle' && state.status[featured.id] ? 'busy' : null} />
          <span>{featured.name}</span>
        </button>
      )}

      <nav className="bot-list" aria-label="Bots del equipo">
        {bots.map(bot => {
          const st = state.status[bot.id]
          const busy = !!st && st.state !== 'idle'

          return (
            <button
              key={bot.id}
              className={`bot-row${bot.id === activeId ? ' active' : ''}`}
              onClick={() => onSelect(bot.id)}
              aria-current={bot.id === activeId ? 'page' : undefined}
            >
              <Avatar name={bot.name} color={bot.color} size={34} status={busy ? 'busy' : null} />
              <span className="bot-row-text">
                <span className="bot-row-name">{bot.name}</span>
                <span className={`bot-row-preview${busy ? ' busy' : ''}`}>{preview(state, bot.id, state.users)}</span>
              </span>
              {state.requests.some(r => r.botId === bot.id) && <span className="pending-dot" title="Espera vuestra respuesta" />}
            </button>
          )
        })}
        {bots.length === 0 && <p className="empty-hint">Ningún bot coincide con “{query}”.</p>}
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
            <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
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
