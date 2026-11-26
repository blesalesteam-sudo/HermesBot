import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Bot, ClientCommand } from '../../shared/protocol'
import { dayLabel, statusLine } from '../lib/format'
import type { ClientState } from '../lib/store'
import { Avatar } from './Avatar'
import { IconBack, IconPanel, IconSend, IconStop } from './icons'
import { Message } from './Message'
import { RequestCard } from './RequestCard'

interface Props {
  state: ClientState
  bot: Bot
  send: (cmd: ClientCommand) => void
  panelOpen: boolean
  onTogglePanel: () => void
  onBack: () => void
}

function senderKey(m: { role: string; authorId?: string }) {
  return m.role === 'user' ? `u:${m.authorId}` : m.role
}

export function Chat({ state, bot, send, panelOpen, onTogglePanel, onBack }: Props) {
  const [draft, setDraft] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const typingSent = useRef(false)
  const typingTimer = useRef<number>()
  const textarea = useRef<HTMLTextAreaElement>(null)

  const messages = state.messages[bot.id] ?? []
  const requests = state.requests.filter(r => r.botId === bot.id)
  const status = state.status[bot.id]
  const working = !!status && status.state !== 'idle'
  const typers = (state.typing[bot.id] ?? []).filter(id => id !== state.me.id)
  const lastLen = messages.length ? messages[messages.length - 1]!.text.length : 0

  useLayoutEffect(() => {
    const el = scroller.current

    if (el && stick.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length, lastLen, requests.length, typers.length, working])

  useEffect(() => {
    stick.current = true
    setDraft('')
    textarea.current?.focus()
  }, [bot.id])

  useEffect(() => {
    const el = textarea.current

    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    }
  }, [draft])

  const setTyping = (on: boolean) => {
    if (typingSent.current !== on) {
      typingSent.current = on
      send({ t: 'typing', botId: bot.id, on })
    }
  }

  const onChange = (v: string) => {
    setDraft(v)
    setTyping(v.trim().length > 0)
    window.clearTimeout(typingTimer.current)
    typingTimer.current = window.setTimeout(() => setTyping(false), 4000)
  }

  const submit = () => {
    const text = draft.trim()

    if (!text) { return }
    send({ t: 'send', botId: bot.id, text })
    setDraft('')
    setTyping(false)
    stick.current = true
  }

  const typerNames = typers.map(id => state.users.find(u => u.id === id)?.name ?? 'Tu socio')

  return (
    <section className="chat" aria-label={`Conversación con ${bot.name}`}>
      <header className="chat-head">
        <button className="icon-btn only-mobile" onClick={onBack} aria-label="Volver a los bots"><IconBack /></button>
        <Avatar name={bot.name} color={bot.color} size={36} />
        <div className="chat-head-text">
          <div className="chat-head-name">{bot.name}</div>
          <div className={`chat-head-status${working ? ' busy' : ''}`}>
            {working && <span className="pulse" />}
            {working ? statusLine(status) : bot.role}
          </div>
        </div>
        {state.hermes !== 'connected' && state.hermes !== 'demo' && (
          <span className="conn-chip" title={state.hermesDetail}>{state.hermes === 'connecting' ? 'Conectando con Hermes…' : 'Hermes no responde'}</span>
        )}
        {state.hermes === 'demo' && <span className="conn-chip demo">Vista previa · datos de prueba</span>}
        <button className={`icon-btn${panelOpen ? ' on' : ''}`} onClick={onTogglePanel} aria-label="Mostrar u ocultar el panel lateral" title="Panel lateral">
          <IconPanel />
        </button>
      </header>

      <div
        className="transcript"
        ref={scroller}
        onScroll={e => {
          const el = e.currentTarget

          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        <div className="transcript-inner">
          {messages.length === 0 && (
            <div className="welcome">
              <Avatar name={bot.name} color={bot.color} size={64} />
              <h2>{bot.name}</h2>
              <p>{bot.role}</p>
              <p className="welcome-hint">Escribid lo que necesitéis. Los dos veréis esta conversación en vivo.</p>
            </div>
          )}
          {messages.map((m, i) => {
            const prev = messages[i - 1]
            const next = messages[i + 1]
            const newDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString()
            const first = newDay || !prev || senderKey(prev) !== senderKey(m)
            const last = !next || senderKey(next) !== senderKey(m) || new Date(next.ts).toDateString() !== new Date(m.ts).toDateString()

            return (
              <Fragment key={m.id}>
                {newDay && <div className="day"><span>{dayLabel(m.ts)}</span></div>}
                <Message msg={m} bot={bot} me={state.me} users={state.users} first={first} last={last} waiting={requests.length > 0} />
              </Fragment>
            )
          })}
          {requests.map(r => <RequestCard key={r.id} req={r} send={send} />)}
          {typerNames.length > 0 && (
            <div className="typing-line">
              <span className="dots"><i /><i /><i /></span>
              {typerNames.join(' y ')} {typerNames.length > 1 ? 'están' : 'está'} escribiendo…
            </div>
          )}
        </div>
      </div>

      <form className="composer-wrap" onSubmit={e => { e.preventDefault(); submit() }}>
        <div className="composer">
          <textarea
            ref={textarea}
            rows={1}
            value={draft}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={`Escribe a ${bot.name}…`}
            aria-label="Mensaje"
          />
          {working && !draft.trim() ? (
            <button type="button" className="send stop" onClick={() => send({ t: 'stop', botId: bot.id })} aria-label="Detener">
              <IconStop width={16} height={16} />
            </button>
          ) : (
            <button type="submit" className="send" disabled={!draft.trim()} aria-label="Enviar">
              <IconSend width={18} height={18} />
            </button>
          )}
        </div>
        <div className="composer-hint">Lo que escribas lo verá también tu socio. Hermes sabrá quién de los dos habla.</div>
      </form>
    </section>
  )
}
