import { memo, useState } from 'react'

import type { Attachment, ChatMessage, ToolCall, User } from '../../shared/protocol'
import { clock, fileSize, renderMarkdown } from '../lib/format'
import { Avatar } from './Avatar'
import { IconBolt, IconCheck, IconChevron, IconCopy, IconFile } from './icons'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)

    return true
  } catch {
    return false
  }
}

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

function Attachments({ items, mine }: { items: Attachment[]; mine: boolean }) {
  return (
    <div className={`attachments${mine ? ' mine' : ''}`}>
      {items.map(a => a.kind === 'image' && (a.url || a.preview) ? (
        <a key={a.id} className="att-image" href={a.url ?? a.preview} target="_blank" rel="noreferrer" title={a.name}><img src={a.url ?? a.preview} alt={a.name} loading="lazy" /></a>
      ) : a.url ? (
        <a key={a.id} className="att-file link" href={a.url} target="_blank" rel="noreferrer" download={a.name} title={`Descargar ${a.name}`}>
          <span className="att-icon"><IconFile width={18} height={18} /></span>
          <span className="att-text">
            <span className="att-name">{a.name}</span>
            <span className="att-size">{fileSize(a.size)} · Descargar</span>
          </span>
        </a>
      ) : (
        <div key={a.id} className="att-file">
          <span className="att-icon"><IconFile width={18} height={18} /></span>
          <span className="att-text">
            <span className="att-name">{a.name}</span>
            <span className="att-size">{fileSize(a.size)}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)

  return (
    <button
      className="msg-action"
      aria-label="Copiar mensaje"
      title={done ? 'Copiado' : 'Copiar'}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true)
          window.setTimeout(() => setDone(false), 1400)
        }
      }}
    >
      {done ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
    </button>
  )
}

interface Props {
  msg: ChatMessage
  me: User
  users: User[]
  /** Primer mensaje de una racha del mismo remitente: muestra nombre y avatar. */
  first: boolean
  last: boolean
}

export const Message = memo(function Message({ msg, me, users, first, last }: Props) {
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
          {!!msg.attachments?.length && <Attachments items={msg.attachments} mine={mine} />}
          {msg.text && (
            <div className={`bubble ${mine ? 'bubble-me' : 'bubble-partner'}`}>
              <span className="bubble-text">{msg.text}</span>
            </div>
          )}
        </div>
        <div className="row-meta">
          <span>{clock(msg.ts)}</span>
          {msg.text && <CopyButton text={msg.text} />}
        </div>
      </div>
    )
  }

  const empty = !msg.text.trim()

  return (
    <div className={`row row-bot${first ? ' first' : ''}${last ? ' last' : ''}`}>
      <div className="row-body">
        {!!msg.tools?.length && <ToolPill tools={msg.tools} />}
        {!!msg.attachments?.length && <Attachments items={msg.attachments} mine={false} />}
        {!empty && (
          <div
            className={`bubble bubble-bot${msg.error ? ' error' : ''}${msg.streaming ? ' streaming' : ''}`}
            onClick={e => {
              const btn = (e.target as HTMLElement).closest('.code-copy')

              if (btn) {
                void copyText(btn.closest('.code')?.querySelector('pre')?.textContent ?? '').then(ok => {
                  if (ok) {
                    btn.textContent = 'Copiado'
                    window.setTimeout(() => { btn.textContent = 'Copiar' }, 1400)
                  }
                })
              }
            }}
          >
            <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
          </div>
        )}
      </div>
      {!empty && !msg.streaming && (
        <div className="row-meta">
          <CopyButton text={msg.text} />
          <span>{clock(msg.ts)}</span>
        </div>
      )}
    </div>
  )
})
