import { useState } from 'react'

import type { ClientCommand, PendingRequest } from '../../shared/protocol'
import { IconCheck, IconQuestion, IconShield, IconX } from './icons'

interface Props {
  req: PendingRequest
  send: (cmd: ClientCommand) => void
}

export function RequestCard({ req, send }: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const act = (cmd: ClientCommand) => {
    setBusy(true)
    send(cmd)
  }

  if (req.kind === 'approval') {
    return (
      <div className="req-card" role="group" aria-label="Petición de permiso">
        <div className="req-head">
          <span className="req-icon warn"><IconShield width={18} height={18} /></span>
          <span className="req-title">{req.title}</span>
        </div>
        {req.command && <div className="req-command">{req.command}</div>}
        {req.detail && <p className="req-detail">{req.detail}</p>}
        <div className="req-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => act({ t: 'approve', reqId: req.id, choice: 'once' })}>
            <IconCheck width={16} height={16} /> Permitir
          </button>
          <button className="btn" disabled={busy} onClick={() => act({ t: 'approve', reqId: req.id, choice: 'session' })}>
            Permitir en esta conversación
          </button>
          <button className="btn btn-danger" disabled={busy} onClick={() => act({ t: 'approve', reqId: req.id, choice: 'deny' })}>
            <IconX width={16} height={16} /> Denegar
          </button>
        </div>
      </div>
    )
  }

  if (req.kind === 'secret') {
    return (
      <div className="req-card" role="group" aria-label="Dato privado">
        <div className="req-head">
          <span className="req-icon"><IconShield width={18} height={18} /></span>
          <span className="req-title">{req.title}</span>
        </div>
        {req.detail && <p className="req-detail">{req.detail}</p>}
        <form className="req-free" onSubmit={e => { e.preventDefault(); if (text) { act({ t: 'secret', reqId: req.id, value: text }) } }}>
          <input type="password" value={text} onChange={e => setText(e.target.value)} placeholder="Escribe aquí" autoComplete="off" />
          <button className="btn btn-primary" disabled={busy || !text}>Enviar</button>
          <button type="button" className="btn" disabled={busy} onClick={() => act({ t: 'secret', reqId: req.id, value: null })}>Cancelar</button>
        </form>
      </div>
    )
  }

  return (
    <div className="req-card" role="group" aria-label="Pregunta del bot">
      <div className="req-head">
        <span className="req-icon"><IconQuestion width={18} height={18} /></span>
        <span className="req-title">{req.title}</span>
      </div>
      {req.question && <p className="req-question">{req.question}</p>}
      {!!req.choices?.length && (
        <div className="req-actions">
          {req.choices.map(c => (
            <button key={c} className="btn" disabled={busy} onClick={() => act({ t: 'clarify', reqId: req.id, answer: c })}>{c}</button>
          ))}
        </div>
      )}
      <form className="req-free" onSubmit={e => { e.preventDefault(); if (text.trim()) { act({ t: 'clarify', reqId: req.id, answer: text.trim() }) } }}>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="O escribe tu respuesta" />
        <button className="btn btn-primary" disabled={busy || !text.trim()}>Responder</button>
        <button type="button" className="btn" disabled={busy} onClick={() => act({ t: 'clarify', reqId: req.id, answer: null })}>Omitir</button>
      </form>
    </div>
  )
}
