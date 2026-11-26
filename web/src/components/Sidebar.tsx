import { useMemo, useState } from 'react'

import type { User } from '../../shared/protocol'
import { statusLine } from '../lib/format'
import type { ClientState } from '../lib/store'
import { Avatar } from './Avatar'
import { IconLogout, IconMoon, IconSearch, IconSun } from './icons'

interface Props {
  state: ClientState
  activeId: string
  onSelect: (id: string) => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onLogout: () => void
}

function preview(state: ClientState, botId: string, users: User[]): string {
  const typing = state.typing[botId] ?? []

  if (typing.length) {
    const who = users.find(u => u.id === typing[0])

    return `${who?.name ?? 'Tu socio'} está escribiendo…`
  }

  const list = state.messages[botId] ?? []
  const last = [...list].reverse().find(m => m.text.trim())

  if (!last) { return 'Sin mensajes todavía' }

  const plain = last.text.replace(/[*_>`#]/g, '').replace(/\s+/g, ' ').trim()

  if (last.role === 'user') {
    const who = last.authorId === state.me.id ? 'Tú' : users.find(u => u.id === last.authorId)?.name ?? 'Socio'

    return `${who}: ${plain}`
  }

  return plain
}

export function Sidebar({ state, activeId, onSelect, theme, onToggleTheme, onLogout }: Props) {
  const [query, setQuery] = useState('')
  const bots = useMemo(() => {
    const q = query.trim().toLowerCase()

    return q ? state.bots.filter(b => `${b.name} ${b.role}`.toLowerCase().includes(q)) : state.bots
  }, [query, state.bots])
  const partner = state.users.find(u => u.id !== state.me.id)
  const partnerOnline = partner ? state.online.includes(partner.id) : false

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">h</span>
        <span className="brand-name">hermesBot</span>
      </div>

      <label className="search">
        <IconSearch width={17} height={17} />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar" aria-label="Buscar bots" />
      </label>

      <div className="group-label">Bots del equipo</div>
      <nav className="bot-list" aria-label="Bots del equipo">
        {bots.map(bot => {
          const st = state.status[bot.id]
          const busy = st && st.state !== 'idle'
          const pending = state.requests.some(r => r.botId === bot.id)

          return (
            <button
              key={bot.id}
              className={`bot-row${bot.id === activeId ? ' active' : ''}`}
              onClick={() => onSelect(bot.id)}
              aria-current={bot.id === activeId ? 'page' : undefined}
            >
              <Avatar name={bot.name} color={bot.color} size={40} status={busy ? 'busy' : st?.lastActive && Date.now() - st.lastActive < 120_000 ? 'online' : null} />
              <span className="bot-row-text">
                <span className="bot-row-top">
                  <span className="bot-row-name">{bot.name}</span>
                  {pending && <span className="pending-dot" title="Espera vuestra respuesta" />}
                </span>
                <span className={`bot-row-status${busy ? ' busy' : ''}`}>{statusLine(st)}</span>
                <span className="bot-row-preview">{preview(state, bot.id, state.users)}</span>
              </span>
            </button>
          )
        })}
        {bots.length === 0 && <p className="empty-hint">Ningún bot coincide con “{query}”.</p>}
      </nav>

      <div className="sidebar-foot">
        <div className="me">
          <Avatar name={state.me.name} color={state.me.color} src={state.me.avatar} size={32} status="online" />
          <span className="me-text">
            <span className="me-name">{state.me.name}</span>
            <span className="me-sub">
              {partner ? `${partner.name} ${partnerOnline ? 'está conectado' : 'no está conectado'}` : ''}
            </span>
          </span>
        </div>
        <button className="icon-btn" onClick={onToggleTheme} title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'} aria-label="Cambiar tema">
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
        </button>
        <button className="icon-btn" onClick={onLogout} title="Cerrar sesión" aria-label="Cerrar sesión">
          <IconLogout />
        </button>
      </div>
    </aside>
  )
}
