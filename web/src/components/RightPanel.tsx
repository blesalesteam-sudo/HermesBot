import { useState } from 'react'

import type { Bot } from '../../shared/protocol'
import type { ClientState } from '../lib/store'
import { Avatar } from './Avatar'
import { IconChevron, IconClock, IconMonitor, IconX } from './icons'

interface Props {
  state: ClientState
  bot: Bot
  onClose: () => void
}

// Rutinas de ejemplo: en la Fase 1 este panel es visual. En la siguiente fase leerá las
// rutinas reales de Hermes y se crearán escribiéndolas en lenguaje normal.
const SAMPLE_ROUTINES = [
  { when: 'Lunes a viernes a las 9:00', what: 'Resumen de prioridades del día' },
  { when: 'Viernes a las 17:00', what: 'Repaso de acuerdos de la semana' }
]

export function RightPanel({ state, bot, onClose }: Props) {
  const [tab, setTab] = useState<'actividad' | 'biblioteca'>('actividad')
  const st = state.status[bot.id]
  const awake = st?.state === 'working' && !state.requests.some(r => r.botId === bot.id)

  return (
    <aside className="right-panel" aria-label="Detalles del bot">
      <button className="round-btn rp-close" onClick={onClose} aria-label="Cerrar panel"><IconX width={17} height={17} /></button>
      <div className="rp-hero">
        <Avatar name={bot.name} color={bot.color} size={64} />
        <h2>{bot.name}</h2>
        <p>{bot.role}</p>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'actividad'} className={tab === 'actividad' ? 'on' : ''} onClick={() => setTab('actividad')}>Actividad</button>
          <button role="tab" aria-selected={tab === 'biblioteca'} className={tab === 'biblioteca' ? 'on' : ''} onClick={() => setTab('biblioteca')}>Biblioteca</button>
        </div>
      </div>

      {tab === 'actividad' ? (
        <>
          <div className="rp-label">Pantalla del bot</div>
          <div className="rp-card computer">
            <div>
              <div className="rp-card-title">Ordenador del bot</div>
              <div className={`rp-card-sub${awake ? ' live' : ''}`}>{awake ? st?.label || 'Trabajando…' : 'Dormido'}</div>
            </div>
            <div className={`thumb${awake ? ' live' : ''}`}><IconMonitor width={20} height={20} /></div>
          </div>

          <div className="rp-label">Rutinas <span className="tag">Próximamente</span></div>
          <div className="rp-card list">
            {SAMPLE_ROUTINES.map(r => (
              <div key={r.when} className="routine">
                <IconClock width={16} height={16} />
                <div>
                  <div className="rp-card-title">{r.when}</div>
                  <div className="rp-card-sub">{r.what}</div>
                </div>
              </div>
            ))}
            <button className="routine add" disabled>
              <IconClock width={16} height={16} />
              <span className="rp-card-title">Crear una rutina</span>
              <IconChevron width={14} height={14} />
            </button>
          </div>

          <div className="rp-label">En esta conversación</div>
          <div className="rp-card list people">
            {state.users.map(u => (
              <div key={u.id} className="routine">
                <Avatar name={u.name} color={u.color} src={u.avatar} size={24} />
                <div className="rp-card-title">{u.name}{u.id === state.me.id ? ' (tú)' : ''}</div>
                <span className={`presence${state.online.includes(u.id) ? ' on' : ''}`} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="rp-empty">Aquí aparecerán los archivos y documentos que el bot cree o reciba en esta conversación.</p>
      )}
    </aside>
  )
}
