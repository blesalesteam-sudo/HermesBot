import { useMemo, useState } from 'react'

import type { Bot, ClientCommand } from '../../shared/protocol'
import { clock, extractLinks, fileSize, shortWhen } from '../lib/format'
import type { ClientState } from '../lib/store'
import { Avatar } from './Avatar'
import { IconClock, IconFile, IconLink, IconMonitor, IconPause, IconPlay, IconPlus, IconTrash, IconX } from './icons'

interface Props {
  state: ClientState
  bot: Bot
  send: (cmd: ClientCommand) => void
  onClose: () => void
  onPrefill: (text: string) => void
}

export function RightPanel({ state, bot, send, onClose, onPrefill }: Props) {
  const [tab, setTab] = useState<'actividad' | 'biblioteca'>('actividad')
  const [confirm, setConfirm] = useState<string | null>(null)
  const st = state.status[bot.id]
  const waiting = state.requests.some(r => r.botId === bot.id)
  const awake = !!st && st.state !== 'idle' && !waiting
  const messages = state.messages[bot.id] ?? []
  const routines = state.routines ?? []

  const actions = useMemo(
    () => messages.flatMap(m => (m.tools ?? []).map(t => ({ ...t, ts: m.ts }))).slice(-7).reverse(),
    [messages]
  )
  const files = useMemo(() => messages.flatMap(m => (m.attachments ?? []).map(a => ({ ...a, ts: m.ts }))).reverse(), [messages])
  const links = useMemo(
    () => [...new Set(messages.filter(m => m.role !== 'notice').flatMap(m => extractLinks(m.text)))].reverse().slice(0, 30),
    [messages]
  )
  return (
    <aside className="right-panel" aria-label="Detalles del bot" style={{ ['--bot' as string]: bot.color }}>
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
              <div className={`rp-card-sub${awake ? ' live' : ''}`}>{awake ? st?.label || 'Trabajando…' : waiting ? 'Espera vuestra respuesta' : 'Dormido'}</div>
            </div>
            <div className={`thumb${awake ? ' live' : ''}`}><IconMonitor width={20} height={20} /></div>
          </div>

          <div className="rp-label">Últimas acciones</div>
          {actions.length ? (
            <ol className="timeline">
              {actions.map(a => (
                <li key={a.id} className={a.status}>
                  <span className="timeline-dot" />
                  <span className="timeline-text">
                    <span>{a.label}</span>
                    {a.detail && <span className="timeline-detail">{a.detail}</span>}
                  </span>
                  <time>{clock(a.ts)}</time>
                </li>
              ))}
            </ol>
          ) : <p className="rp-empty small">Aquí verás lo que el bot va haciendo: búsquedas, archivos, comandos…</p>}

          <div className="rp-label">Rutinas</div>
          <div className="rp-card list">
            {routines.map(r => (
              <div key={r.id} className={`routine${r.enabled ? '' : ' off'}`}>
                <span className="routine-icon"><IconClock width={15} height={15} /></span>
                <div>
                  <div className="rp-card-title">{r.name}</div>
                  <div className="rp-card-sub">{r.enabled ? r.when : 'En pausa'}</div>
                </div>
                {confirm === r.id ? (
                  <span className="routine-actions show">
                    <button className="btn small danger" onClick={() => { send({ t: 'routine', id: r.id, action: 'remove' }); setConfirm(null) }}>Borrar</button>
                    <button className="btn small" onClick={() => setConfirm(null)}>No</button>
                  </span>
                ) : (
                  <span className="routine-actions">
                    <button className="mini-btn" onClick={() => send({ t: 'routine', id: r.id, action: r.enabled ? 'pause' : 'resume' })} aria-label={r.enabled ? 'Pausar rutina' : 'Reanudar rutina'} title={r.enabled ? 'Pausar' : 'Reanudar'}>
                      {r.enabled ? <IconPause width={14} height={14} /> : <IconPlay width={14} height={14} />}
                    </button>
                    <button className="mini-btn" onClick={() => setConfirm(r.id)} aria-label="Borrar rutina" title="Borrar"><IconTrash width={14} height={14} /></button>
                  </span>
                )}
              </div>
            ))}
            {routines.length === 0 && <p className="rp-empty small">Todavía no hay rutinas. Pídesela al bot con tus palabras.</p>}
            <button className="routine add" onClick={() => onPrefill('Crea una rutina: cada lunes a las 9:00 ')}>
              <span className="routine-icon"><IconPlus width={15} height={15} /></span>
              <span className="rp-card-title">Crear una rutina</span>
            </button>
          </div>

          <div className="rp-label">En esta conversación</div>
          <div className="rp-card list people">
            {state.users.map(u => (
              <div key={u.id} className="routine">
                <Avatar name={u.name} color={u.color} src={u.avatar} size={26} />
                <div>
                  <div className="rp-card-title">{u.name}{u.id === state.me.id ? ' (tú)' : ''}</div>
                  <div className="rp-card-sub">{state.online.includes(u.id) ? 'En línea' : 'Desconectado'}</div>
                </div>
                <span className={`presence${state.online.includes(u.id) ? ' on' : ''}`} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="rp-label">Archivos</div>
          {files.length ? (
            <div className="lib-grid">
              {files.map(f => f.kind === 'image' && f.preview ? (
                <a key={f.id} className="lib-image" href={f.preview} target="_blank" rel="noreferrer" title={f.name}><img src={f.preview} alt={f.name} /></a>
              ) : (
                <div key={f.id} className="lib-file" title={f.name}>
                  <IconFile width={20} height={20} />
                  <span>{f.name}</span>
                  <small>{fileSize(f.size)} · {shortWhen(f.ts)}</small>
                </div>
              ))}
            </div>
          ) : <p className="rp-empty small">Las fotos y archivos que compartáis en este chat aparecerán aquí.</p>}

          <div className="rp-label">Enlaces</div>
          {links.length ? (
            <div className="rp-card list">
              {links.map(l => {
                let host = l

                try { host = new URL(l).hostname.replace(/^www\./, '') } catch { /* se muestra tal cual */ }

                return (
                  <a key={l} className="routine link" href={l} target="_blank" rel="noreferrer">
                    <span className="routine-icon"><IconLink width={15} height={15} /></span>
                    <div>
                      <div className="rp-card-title">{host}</div>
                      <div className="rp-card-sub">{l.replace(/^https?:\/\/(www\.)?/, '')}</div>
                    </div>
                  </a>
                )
              })}
            </div>
          ) : <p className="rp-empty small">Los enlaces que aparezcan en la conversación se guardan aquí.</p>}
        </>
      )}
    </aside>
  )
}
