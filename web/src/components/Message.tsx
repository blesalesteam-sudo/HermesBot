import { memo, useState } from 'react'

import type { Bot, ChatMessage, ToolCall, User } from '../../shared/protocol'
import { clock, renderMarkdown } from '../lib/format'
import { Avatar } from './Avatar'
import { IconBolt, IconChevron } from './icons'

function ToolPill({ tools }: { tools: ToolCall[] }) {
  const [open, setOpen] = useState(false)
  const running = tools.filter(t => t.status === 'running').length
  const label = running
    ? `Usando ${tools.length === 1 ? 'una herramienta' : `${tools.length} herramientas`}…`
    : `Usó ${tools.length === 1 ? '1 herramienta' : `${tools.length} herramientas`}`

  return (
    <div className="tool-pill-wrap">
      <button className={`tool-pill${running ? ' running' : ''}`} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <IconBolt width={13} height={13} />
        <span>{label}</span>
        <span className="tool-pill-sep">·</span>
        <span className="tool-pill-more">{open ? 'Ocultar' : 'Ver detalle'}</span>
        <IconChevron width={12} height={12} className={`chev${open ? ' open' : ''}`} />
      </button>
      {open && (
        <ul className="tool-list">
          {tools.map(t => (
            <li key={t.id} className={`tool-item ${t.status}`}>
              <span className="tool-dot" />
              <span className="tool-label">{t.label}</span>
              {t.detail && <span className="tool-detail" title={t.detail}>{t.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface Props {
  msg: ChatMessage
  bot: Bot
  me: User
  users: User[]
  /** Primer mensaje de una racha del mismo remitente: muestra nombre y avatar. */
  first: boolean
  last: boolean
  /** El bot espera una respuesta de los socios: no se pintan los puntos de "escribiendo". */
  waiting?: boolean
}

export const Message = memo(function Message({ msg, bot, me, users, first, last, waiting }: Props) {
  if (msg.role === 'notice') {
    return <div className={`notice${msg.error ? ' error' : ''}`}>{msg.text}</div>
  }

  if (msg.role === 'user') {
    const mine = msg.authorId === me.id
    const author = users.find(u => u.id === msg.authorId)

    return (
      <div className={`row ${mine ? 'row-me' : 'row-them'}${first ? ' first' : ''}${last ? ' last' : ''}`}>
        {!mine && (
          <div className="row-avatar">{last && author && <Avatar name={author.name} color={author.color} src={author.avatar} size={28} />}</div>
        )}
        <div className="row-body">
          {first && !mine && <div className="sender" style={{ color: author?.color }}>{author?.name ?? 'Socio'}</div>}
          <div className={`bubble ${mine ? 'bubble-me' : 'bubble-partner'}`} title={clock(msg.ts)}>
            <span className="bubble-text">{msg.text}</span>
          </div>
        </div>
      </div>
    )
  }

  const empty = !msg.text.trim()

  return (
    <div className={`row row-bot${first ? ' first' : ''}${last ? ' last' : ''}`}>
      <div className="row-avatar">{last && <Avatar name={bot.name} color={bot.color} size={28} />}</div>
      <div className="row-body">
        {first && <div className="sender" style={{ color: bot.color }}>{bot.name}</div>}
        {!!msg.tools?.length && <ToolPill tools={msg.tools} />}
        {(!empty || (msg.streaming && !msg.tools?.length && !waiting)) && (
          <div className={`bubble bubble-bot${msg.error ? ' error' : ''}`} title={clock(msg.ts)}>
            {empty ? (
              <span className="dots" aria-label="Escribiendo"><i /><i /><i /></span>
            ) : (
              <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
            )}
            {msg.streaming && !empty && <span className="caret" aria-hidden="true" />}
          </div>
        )}
      </div>
    </div>
  )
})
