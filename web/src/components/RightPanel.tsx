import type { Bot } from '../../shared/protocol'
import type { ClientState } from '../lib/store'
import { IconClock, IconMonitor, IconX } from './icons'

interface Props {
  state: ClientState
  bot: Bot
  onClose: () => void
}

// Rutinas de ejemplo (en la Fase 1 este panel es solo visual; en la siguiente fase leerá
// las rutinas reales de Hermes y permitirá crearlas escribiéndolas en lenguaje normal).
const SAMPLE_ROUTINES = [
  { when: 'Lunes a viernes a las 9:00', what: 'Resumen de prioridades del día' },
  { when: 'Viernes a las 17:00', what: 'Repaso de acuerdos de la semana' }
]

export function RightPanel({ state, bot, onClose }: Props) {
  const st = state.status[bot.id]
  const browsing = st?.state === 'working' && !state.requests.some(r => r.botId === bot.id)

  return (
    <aside className="right-panel" aria-label="Panel del bot">
      <div className="rp-head">
        <span>Panel de {bot.name}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar panel"><IconX width={18} height={18} /></button>
      </div>

      <section className="widget">
        <div className="widget-title"><IconMonitor width={16} height={16} /> Pantalla del bot</div>
        <div className={`screen${browsing ? ' live' : ''}`}>
          <div className="screen-bar"><i /><i /><i /><span>{browsing ? 'En directo' : 'Sin actividad'}</span></div>
          <div className="screen-body">
            {browsing ? (
              <>
                <span className="pulse big" />
                <p>{st?.label || 'Trabajando…'}</p>
              </>
            ) : (
              <p>Cuando el bot navegue por internet o use su ordenador, lo veréis aquí en directo.</p>
            )}
          </div>
        </div>
      </section>

      <section className="widget">
        <div className="widget-title"><IconClock width={16} height={16} /> Rutinas <span className="tag">Próximamente</span></div>
        <ul className="routines">
          {SAMPLE_ROUTINES.map(r => (
            <li key={r.when} className="routine">
              <span className="routine-when">{r.when}</span>
              <span className="routine-what">{r.what}</span>
            </li>
          ))}
        </ul>
        <p className="widget-hint">Ejemplos. Pronto podréis pedirle al bot “cada lunes a las 9 prepárame…” y aparecerá aquí.</p>
      </section>
    </aside>
  )
}
