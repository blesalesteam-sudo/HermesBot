import { useEffect, useState } from 'react'

import type { ClientCommand, Widget } from '../../shared/protocol'
import type { ClientState } from '../lib/store'
import { IconCheck, IconCopy, IconPlus, IconTrash } from './icons'
import { Badge } from './SettingsApps'

type Send = (cmd: ClientCommand) => void

const snippet = (w: Widget) => `<script src="${location.origin}/widget.js" data-token="${w.token}" async></script>`

function WidgetForm({ widget, state, send, onDone }: { widget?: Widget; state: ClientState; send: Send; onDone: () => void }) {
  const [name, setName] = useState(widget?.name ?? '')
  const [botId, setBotId] = useState(widget?.botId ?? state.bots[0]?.id ?? '')
  const [origins, setOrigins] = useState(widget?.origins.join(', ') ?? '')

  return (
    <form className="widget-form" onSubmit={e => { e.preventDefault(); send({ t: 'widget.save', id: widget?.id, name, botId, origins }); onDone() }}>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Nombre</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Por ejemplo: CRM" maxLength={40} autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Bot que aparece</span>
          <select value={botId} onChange={e => setBotId(e.target.value)}>
            {state.bots.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span className="field-label">Webs donde se puede mostrar</span>
        <input value={origins} onChange={e => setOrigins(e.target.value)} placeholder="crm.miempresa.com, canvas.miempresa.com" autoComplete="off" />
        <span className="field-hint">Separadas por comas. Si lo dejas vacío funciona en cualquier web que tenga el código, así que es mejor indicarlas.</span>
      </label>
      <div className="form-actions">
        <button className="btn btn-primary" disabled={!name.trim() || !botId}>{widget ? 'Guardar' : 'Crear widget'}</button>
        <button type="button" className="btn" onClick={onDone}>Cancelar</button>
      </div>
    </form>
  )
}

function WidgetRow({ widget, state, send }: { widget: Widget; state: ClientState; send: Send }) {
  const [open, setOpen] = useState<null | 'code' | 'edit'>(null)
  const [confirm, setConfirm] = useState<null | 'delete' | 'rotate'>(null)
  const [copied, setCopied] = useState(false)
  const bot = state.bots.find(b => b.id === widget.botId)
  const code = snippet(widget)

  return (
    <div className="provider">
      <div className="set-row">
        <Badge name={widget.name} />
        <div className="set-row-text">
          <span>{widget.name}</span>
          <small>{bot ? `Muestra a ${bot.name}` : 'Su bot ya no existe'} · {widget.origins.length ? widget.origins.map(o => o.replace(/^https?:\/\//, '')).join(', ') : 'en cualquier web'}</small>
        </div>
        {confirm === 'delete' ? (
          <>
            <button className="btn small danger" onClick={() => send({ t: 'widget.delete', id: widget.id })}>Eliminar</button>
            <button className="btn small" onClick={() => setConfirm(null)}>No</button>
          </>
        ) : (
          <>
            <button className="btn small" onClick={() => setOpen(o => (o === 'code' ? null : 'code'))}>{open === 'code' ? 'Cerrar' : 'Ver código'}</button>
            <button className="btn small" onClick={() => setOpen(o => (o === 'edit' ? null : 'edit'))}>Editar</button>
            <button className="mini-btn" onClick={() => setConfirm('delete')} aria-label={`Eliminar el widget ${widget.name}`} title="Eliminar"><IconTrash width={15} height={15} /></button>
          </>
        )}
      </div>
      {open === 'edit' && <WidgetForm widget={widget} state={state} send={send} onDone={() => setOpen(null)} />}
      {open === 'code' && (
        <div className="signin">
          <ol className="signin-steps">
            <li><span>Copia esta línea.</span></li>
            <li className="code-line">
              <textarea className="code-box" readOnly rows={3} value={code} onFocus={e => e.currentTarget.select()} aria-label="Código para pegar" />
              <button
                className="btn btn-primary"
                onClick={() => void navigator.clipboard.writeText(code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600) }).catch(() => undefined)}
              >
                {copied ? <><IconCheck width={15} height={15} /> Copiado</> : <><IconCopy width={15} height={15} /> Copiar</>}
              </button>
            </li>
            <li><span>Pégala en tu otra web, justo antes de <b>&lt;/body&gt;</b>. Aparecerá un botón redondo en la esquina que abre el chat con {bot?.name ?? 'el bot'}.</span></li>
          </ol>
          <p className="field-hint">Quien tenga esta línea puede hablar con el bot, así que ponla solo en webs vuestras. Si se filtra, cambia la llave y pega la línea nueva.</p>
          {confirm === 'rotate' ? (
            <div className="form-actions">
              <button className="btn small danger" onClick={() => { send({ t: 'widget.rotate', id: widget.id }); setConfirm(null) }}>Cambiar llave</button>
              <button className="btn small" onClick={() => setConfirm(null)}>Cancelar</button>
            </div>
          ) : (
            <button className="btn small" onClick={() => setConfirm('rotate')}>Cambiar la llave</button>
          )}
        </div>
      )}
    </div>
  )
}

export function WidgetsSection({ state, send }: { state: ClientState; send: Send }) {
  const [adding, setAdding] = useState(false)
  const list = state.widgets

  useEffect(() => { send({ t: 'widgets.get' }) }, [send])

  return (
    <>
      <h3>Widgets</h3>
      <p className="settings-sub">Pon uno de vuestros bots dentro de otra web, como el CRM o canvas-ia. Es la misma conversación que veis aquí, con la misma memoria.</p>
      {!!list?.length && (
        <div className="rows">
          {list.map(w => <WidgetRow key={w.id + w.token} widget={w} state={state} send={send} />)}
        </div>
      )}
      {list && !list.length && !adding && <p className="rp-empty small">Todavía no hay ningún widget.</p>}
      {adding
        ? <div className="rows spaced"><WidgetForm state={state} send={send} onDone={() => setAdding(false)} /></div>
        : <button className="btn add-btn" onClick={() => setAdding(true)}><IconPlus width={16} height={16} /> Crear widget</button>}
    </>
  )
}
