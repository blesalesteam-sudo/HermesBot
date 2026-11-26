import { useEffect, useState } from 'react'

import type { Bot, ClientCommand } from '../../shared/protocol'
import { shortWhen } from '../lib/format'
import type { ClientState } from '../lib/store'
import { IconBack, IconTrash, IconX } from './icons'
import { Message } from './Message'

interface Props {
  state: ClientState
  bot: Bot
  send: (cmd: ClientCommand) => void
  onClose: () => void
}

/** Conversaciones anteriores de un bot: leerlas, recuperarlas, cambiarles el nombre o borrarlas. */
export function History({ state, bot, send, onClose }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const list = (state.history ?? []).filter(c => c.botId === bot.id)
  const meta = openId ? list.find(c => c.id === openId) : undefined
  const chat = openId && state.chat?.id === openId ? state.chat : undefined

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose() } }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Si otra persona la borra o la recupera mientras la miramos, volvemos a la lista.
  useEffect(() => {
    if (openId && !meta) { setOpenId(null) }
  }, [openId, meta])

  const open = (id: string) => {
    setOpenId(id)
    setTitle(null)
    setConfirm(false)
    send({ t: 'chat.open', id })
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal history" role="dialog" aria-modal="true" aria-label="Conversaciones anteriores" style={{ ['--bot' as string]: bot.color }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          {meta ? (
            <button className="back-link" onClick={() => setOpenId(null)}><IconBack width={15} height={15} /> Conversaciones anteriores</button>
          ) : <h2>Conversaciones anteriores con {bot.name}</h2>}
          <button className="round-btn" onClick={onClose} aria-label="Cerrar"><IconX width={17} height={17} /></button>
        </div>

        {!meta ? (
          <>
            <p className="modal-sub">Cada vez que empezáis una conversación nueva, la anterior se guarda aquí. Puedes leerla o recuperarla para seguir donde la dejasteis.</p>
            {list.length ? (
              <div className="rows history-list">
                {list.map(c => (
                  <button key={c.id} className="set-row history-row" onClick={() => open(c.id)}>
                    <div className="set-row-text">
                      <span>{c.title}</span>
                      <small>{shortWhen(c.ts)} · {c.count === 1 ? '1 mensaje' : `${c.count} mensajes`}</small>
                    </div>
                  </button>
                ))}
              </div>
            ) : <p className="rp-empty">Todavía no hay conversaciones anteriores con este bot.</p>}
          </>
        ) : (
          <>
            {title === null ? (
              <div className="history-title">
                <h3>{meta.title}</h3>
                <button className="btn small" onClick={() => setTitle(meta.title)}>Cambiar nombre</button>
              </div>
            ) : (
              <form className="provider-form" onSubmit={e => { e.preventDefault(); send({ t: 'chat.rename', id: meta.id, title }); setTitle(null) }}>
                <input value={title} onChange={e => setTitle(e.target.value)} maxLength={80} autoFocus aria-label="Nombre de la conversación" />
                <button className="btn btn-primary" disabled={!title.trim()}>Guardar</button>
              </form>
            )}
            <div className="history-read">
              {chat ? chat.messages.map((m, i) => {
                const prev = chat.messages[i - 1]
                const next = chat.messages[i + 1]
                const same = (a?: typeof m) => !!a && a.role === m.role && a.authorId === m.authorId

                return <Message key={m.id} msg={m} me={state.me} users={state.users} first={!same(prev)} last={!same(next)} />
              }) : <p className="rp-empty small">Abriendo la conversación…</p>}
            </div>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={() => { send({ t: 'chat.restore', id: meta.id }); onClose() }}>Recuperar y seguir aquí</button>
              {confirm ? (
                <>
                  <button className="btn small danger" onClick={() => { send({ t: 'chat.delete', id: meta.id }); setOpenId(null) }}>Borrar para siempre</button>
                  <button className="btn small" onClick={() => setConfirm(false)}>Cancelar</button>
                </>
              ) : <button className="mini-btn" onClick={() => setConfirm(true)} aria-label="Borrar esta conversación" title="Borrar"><IconTrash width={15} height={15} /></button>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
