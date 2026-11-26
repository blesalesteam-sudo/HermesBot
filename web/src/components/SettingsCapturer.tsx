import { useEffect, useState } from 'react'

import type { CapturerState, ClientCommand } from '../../shared/protocol'
import type { ClientState } from '../lib/store'
import { IconCheck } from './icons'

type Send = (cmd: ClientCommand) => void

const ITEMS: [string, string, string][] = [
  ['tareas', 'Tareas', 'Qué hay que hacer, quién y para cuándo.'],
  ['decisiones', 'Decisiones', 'Lo que se acordó.'],
  ['enlaces', 'Enlaces y archivos', 'Lo que se compartió y para qué.'],
  ['fechas', 'Fechas y plazos', 'Citas, entregas y recordatorios.'],
  ['ideas', 'Ideas', 'Propuestas que quedaron sin decidir.']
]

function Form({ initial, send, onGo }: { initial: CapturerState; send: Send; onGo: (section: 'apps') => void }) {
  const [on, setOn] = useState(initial.on)
  const [groups, setGroups] = useState(initial.groups.split(',').filter(Boolean).join(', '))
  const [notion, setNotion] = useState(initial.notion)
  const [items, setItems] = useState(initial.items)
  const clean = groups.replace(/\s/g, '')
  const valid = !on || (/^-?\d{5,20}(,-?\d{5,20})*$/.test(clean) && !!notion.trim() && items.length > 0)
  const ready = !!initial.telegram && !!initial.notionReady
  const changed = on !== initial.on || clean !== initial.groups || notion.trim() !== initial.notion || items.join() !== initial.items.join()

  return (
    <form onSubmit={e => { e.preventDefault(); send({ t: 'capturer.save', on, groups: clean, notion: notion.trim(), items }) }}>
      <div className="set-label first">Antes de empezar</div>
      <div className="rows">
        {([['Telegram conectado', initial.telegram], ['Notion conectado', initial.notionReady]] as [string, boolean | undefined][]).map(([label, ok]) => (
          <div key={label} className="set-row">
            <span className={`check-dot${ok ? ' ok' : ''}`}>{ok && <IconCheck width={12} height={12} />}</span>
            <div className="set-row-text"><span>{label}</span>{!ok && <small>Se conecta en Aplicaciones.</small>}</div>
            {!ok && <button type="button" className="btn small" onClick={() => onGo('apps')}>Ir a Aplicaciones</button>}
          </div>
        ))}
      </div>

      <div className="set-label">Configuración</div>
      <div className="rows">
        <label className="set-row">
          <div className="set-row-text">
            <span>Capturador activado</span>
            <small>{ready ? 'El bot escucha los grupos elegidos sin responder a cada mensaje.' : 'Conecta primero Telegram y Notion.'}</small>
          </div>
          <input type="checkbox" className="switch" checked={on} disabled={!ready && !on} onChange={e => setOn(e.target.checked)} aria-label="Capturador activado" />
        </label>
      </div>

      {on && (
        <div className="capturer-fields">
          <label className="field">
            <span className="field-label">Dónde se guarda en Notion</span>
            <input value={notion} onChange={e => setNotion(e.target.value)} placeholder="Nombre o enlace de la página o base de datos" maxLength={300} autoComplete="off" />
            <span className="field-hint">Por ejemplo: «Seguimiento de clientes». Tiene que estar compartida con la conexión de Notion.</span>
          </label>
          <label className="field">
            <span className="field-label">Grupos de Telegram que escucha</span>
            <input value={groups} onChange={e => setGroups(e.target.value)} placeholder="-1001234567890, -1009876543210" autoComplete="off" />
            <span className="field-hint">El número de cada grupo, separados por comas. Para verlo: añade un momento a <b>@RawDataBot</b> al grupo, copia el número que aparece junto a «chat» e «id» (empieza por -100) y sácalo del grupo. Añade también vuestro bot al grupo.</span>
          </label>
          <div className="field">
            <span className="field-label">Qué se guarda</span>
            <div className="chip-list">
              {ITEMS.map(([id, label, hint]) => (
                <label key={id} className={`chip-check${items.includes(id) ? ' on' : ''}`} title={hint}>
                  <input type="checkbox" checked={items.includes(id)} onChange={e => setItems(list => (e.target.checked ? ITEMS.map(i => i[0]).filter(i => i === id || list.includes(i)) : list.filter(i => i !== id)))} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <p className="field-hint">Cómo se usa: en el grupo, mencionad al bot y decidle «captura». Guardará en Notion lo hablado desde la última vez y responderá con el enlace. En esos grupos cualquier miembro puede pedirle cosas al bot mencionándolo, así que usadlo en grupos de confianza.</p>
        </div>
      )}

      <div className="form-actions">
        <button className="btn btn-primary" disabled={!valid || !changed}>Guardar</button>
      </div>
    </form>
  )
}

export function CapturerSection({ state, send, onGo }: { state: ClientState; send: Send; onGo: (section: 'apps') => void }) {
  const cap = state.capturer

  useEffect(() => { send({ t: 'capturer.get' }) }, [send])

  return (
    <>
      <h3>Capturador</h3>
      <p className="settings-sub">Guarda en Notion lo importante de vuestros grupos de Telegram: tareas, decisiones, enlaces y fechas. Así no se pierde nada en el chat.</p>
      {cap
        ? <Form key={JSON.stringify([cap.on, cap.groups, cap.notion, cap.items, cap.telegram, cap.notionReady])} initial={cap} send={send} onGo={onGo} />
        : <p className="rp-empty small">{state.hermes === 'connected' || state.hermes === 'demo' ? 'Cargando…' : 'Hermes no está conectado ahora mismo.'}</p>}
    </>
  )
}
