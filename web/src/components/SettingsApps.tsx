import qrcode from 'qrcode-generator'
import { useEffect, useMemo, useState } from 'react'

import type { AppAuth, AppEntry, ClientCommand } from '../../shared/protocol'
import type { ClientState } from '../lib/store'
import { IconSearch, IconTrash } from './icons'

type Send = (cmd: ClientCommand) => void

const TINTS = ['#6d5bd0', '#2f9e8f', '#E78531', '#009957', '#D84F8B', '#0EA5C6', '#c0392b', '#7a6a3a']

/** Distintivo con la inicial: identifica cada cuenta o aplicación sin usar logotipos ajenos. */
export function Badge({ name, size = 34 }: { name: string; size?: number }) {
  let sum = 0

  for (const ch of name) { sum = (sum * 31 + ch.charCodeAt(0)) % 997 }

  return <span className="badge" style={{ width: size, height: size, fontSize: size * 0.42, ['--tint' as string]: TINTS[sum % TINTS.length] }} aria-hidden="true">{name.trim()[0]?.toUpperCase() ?? '?'}</span>
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={value === id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>{label}</button>
      ))}
    </div>
  )
}

function AuthSteps({ flow, send }: { flow: AppAuth; send: Send }) {
  const [pasted, setPasted] = useState('')

  return (
    <div className="signin app-auth">
      <ol className="signin-steps">
        <li>
          <span>Abre la página de la aplicación y acepta el acceso.</span>
          <a className="btn btn-primary" href={flow.url} target="_blank" rel="noreferrer">Abrir la página</a>
        </li>
        <li><span>Al aceptar, tu navegador irá a una página que no carga. Es normal. Copia la dirección entera de esa página (empieza por http://127.0.0.1).</span></li>
        <li>
          <form className="provider-form" onSubmit={e => { e.preventDefault(); send({ t: 'app.finish', id: flow.id, session: flow.session, pasted }) }}>
            <input value={pasted} onChange={e => setPasted(e.target.value)} placeholder="Pega aquí esa dirección" aria-label="Dirección copiada" autoComplete="off" />
            <button className="btn btn-primary" disabled={!pasted.trim()}>Terminar</button>
          </form>
        </li>
      </ol>
      <button className="btn small" onClick={() => send({ t: 'app.cancel', id: flow.id, session: flow.session })}>Cancelar</button>
    </div>
  )
}

function AppTile({ app, admin, flow, send }: { app: AppEntry; admin: boolean; flow?: AppAuth | null; send: Send }) {
  const [confirm, setConfirm] = useState(false)
  const authing = flow?.id === app.id ? flow : null

  return (
    <div className={`app-tile${authing ? ' wide' : ''}`}>
      <div className="app-tile-head">
        <Badge name={app.name} />
        <div className="set-row-text">
          <span>{app.name}</span>
          <small title={app.about}>{app.state === 'on' ? `Conectada${app.tools ? ` · ${app.tools} acciones` : ''}` : app.state === 'auth' ? 'Falta autorizarla' : app.about}</small>
        </div>
        {admin && (confirm ? (
          <>
            <button className="btn small danger" onClick={() => { send({ t: 'app.remove', id: app.id }); setConfirm(false) }}>Quitar</button>
            <button className="btn small" onClick={() => setConfirm(false)}>No</button>
          </>
        ) : app.state === 'off' ? (
          <button className="btn small" onClick={() => send({ t: 'app.connect', id: app.id })}>Conectar</button>
        ) : (
          <>
            {app.state === 'auth' && !authing && <button className="btn small" onClick={() => send({ t: 'app.connect', id: app.id })}>Autorizar</button>}
            <button className="mini-btn" onClick={() => setConfirm(true)} aria-label={`Quitar ${app.name}`} title="Quitar"><IconTrash width={15} height={15} /></button>
          </>
        ))}
      </div>
      {authing && <AuthSteps flow={authing} send={send} />}
    </div>
  )
}

function Telegram({ state, send }: { state: ClientState; send: Send }) {
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState('')
  const [users, setUsers] = useState(state.telegram?.users ?? '')
  const [confirm, setConfirm] = useState(false)
  const on = !!state.telegram?.connected

  return (
    <div className="provider">
      <div className="set-row">
        <Badge name="Telegram" />
        <div className="set-row-text">
          <span>Telegram</span>
          <small>{on ? 'Conectado. Escribid al bot desde Telegram.' : 'Hablad con vuestros bots desde Telegram, también por voz.'}</small>
        </div>
        {confirm ? (
          <>
            <button className="btn small danger" onClick={() => { send({ t: 'telegram.save', token: null }); setConfirm(false) }}>Desconectar</button>
            <button className="btn small" onClick={() => setConfirm(false)}>No</button>
          </>
        ) : (
          <>
            <button className="btn small" onClick={() => setOpen(o => !o)}>{open ? 'Cerrar' : on ? 'Cambiar' : 'Conectar'}</button>
            {on && <button className="mini-btn" onClick={() => setConfirm(true)} aria-label="Desconectar Telegram" title="Desconectar"><IconTrash width={15} height={15} /></button>}
          </>
        )}
      </div>
      {open && (
        <form className="signin" onSubmit={e => { e.preventDefault(); send({ t: 'telegram.save', token, users }); setToken(''); setOpen(false) }}>
          <ol className="signin-steps">
            <li><span>En Telegram, abre el chat <b>@BotFather</b>, escribe <b>/newbot</b> y sigue sus dos preguntas. Te dará una clave larga.</span></li>
            <li>
              <span className="grow"><input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="Pega aquí la clave que te dio BotFather" autoComplete="off" aria-label="Clave del bot de Telegram" /></span>
            </li>
            <li><span>Para que solo vosotros podáis usarlo: cada uno escribe a <b>@userinfobot</b> en Telegram y copia el número que le responde.</span></li>
            <li>
              <span className="grow"><input value={users} onChange={e => setUsers(e.target.value)} placeholder="Vuestros números, separados por comas" inputMode="numeric" autoComplete="off" aria-label="Números de usuario de Telegram" /></span>
            </li>
          </ol>
          <button className="btn btn-primary" disabled={!/^\d{5,}:[\w-]{20,}$/.test(token.trim()) || !/^\d{3,}(\s*,\s*\d{3,})*$/.test(users.trim())}>Guardar y activar</button>
        </form>
      )}
    </div>
  )
}

/** El código QR dibujado aquí mismo (no sale de la página ni se pide a ningún servicio). */
function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'L')

    qr.addData(text)
    qr.make()

    return qr.createSvgTag({ cellSize: 4, margin: 3, scalable: true })
  }, [text])

  return <div className="qr" role="img" aria-label="Código QR para vincular WhatsApp" dangerouslySetInnerHTML={{ __html: svg }} />
}

function WhatsApp({ state, send }: { state: ClientState; send: Send }) {
  const wa = state.whatsapp
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'bot' | 'self-chat'>(wa?.mode ?? 'bot')
  const [users, setUsers] = useState(wa?.users ?? '')
  const [confirm, setConfirm] = useState(false)
  const pairing = wa?.pairing && wa.pairing.status !== 'done' ? wa.pairing : null
  const on = !!wa?.connected || wa?.pairing?.status === 'done'
  const clean = users.replace(/[\s+().-]/g, '')
  const valid = /^\d{7,15}(,\d{7,15})*$/.test(clean)

  return (
    <div className="provider">
      <div className="set-row">
        <Badge name="WhatsApp" />
        <div className="set-row-text">
          <span>WhatsApp</span>
          <small>{on ? 'Vinculado. Escribid al bot desde WhatsApp.' : 'Hablad con vuestros bots desde WhatsApp. Se vincula escaneando un código QR.'}</small>
        </div>
        {confirm ? (
          <>
            <button className="btn small danger" onClick={() => { send({ t: 'whatsapp.stop', unlink: true }); setConfirm(false) }}>Desvincular</button>
            <button className="btn small" onClick={() => setConfirm(false)}>No</button>
          </>
        ) : pairing ? null : (
          <>
            <button className="btn small" onClick={() => setOpen(o => !o)}>{open ? 'Cerrar' : on ? 'Volver a vincular' : 'Vincular'}</button>
            {on && <button className="mini-btn" onClick={() => setConfirm(true)} aria-label="Desvincular WhatsApp" title="Desvincular"><IconTrash width={15} height={15} /></button>}
          </>
        )}
      </div>
      {pairing ? (
        <div className="signin">
          {pairing.status === 'error' ? (
            <>
              <p className="login-error">{pairing.error || 'No se pudo vincular.'}</p>
              <button className="btn small" onClick={() => send({ t: 'whatsapp.stop' })}>Cerrar</button>
            </>
          ) : (
            <>
              <div className="qr-row">
                {pairing.status === 'qr' && pairing.qr
                  ? <Qr text={pairing.qr} />
                  : <div className="qr waiting"><span className="dots"><i /><i /><i /></span></div>}
                <ol className="signin-steps">
                  <li><span>Abre WhatsApp en el móvil {mode === 'bot' ? <>que tiene <b>el número del bot</b></> : null}.</span></li>
                  <li><span>Entra en <b>Ajustes</b> y después en <b>Dispositivos vinculados</b>.</span></li>
                  <li><span>Pulsa <b>Vincular un dispositivo</b> y apunta la cámara a este código.</span></li>
                </ol>
              </div>
              <p className="field-hint">{pairing.status === 'preparing' ? 'Preparando el código… La primera vez puede tardar un par de minutos.' : 'El código se renueva solo cada pocos segundos. Al escanearlo, esta pantalla se actualiza sola.'}</p>
              <button className="btn small" onClick={() => send({ t: 'whatsapp.stop' })}>Cancelar</button>
            </>
          )}
        </div>
      ) : open && (
        <form className="signin" onSubmit={e => { e.preventDefault(); send({ t: 'whatsapp.start', mode, users: clean }); setOpen(false) }}>
          <div className="choice-list" role="radiogroup" aria-label="Qué número usar">
            <label className={`choice${mode === 'bot' ? ' on' : ''}`}>
              <input type="radio" name="wa-mode" checked={mode === 'bot'} onChange={() => setMode('bot')} />
              <span><b>Un número solo para el bot</b> (recomendado)<small>Escribís al bot como a cualquier contacto. Necesita un segundo número con WhatsApp; sirve WhatsApp Business en el mismo móvil.</small></span>
            </label>
            <label className={`choice${mode === 'self-chat' ? ' on' : ''}`}>
              <input type="radio" name="wa-mode" checked={mode === 'self-chat'} onChange={() => setMode('self-chat')} />
              <span><b>Mi propio número</b><small>Hablas con el bot en el chat «Mensaje para ti». Rápido de montar, pero solo lo usa una persona.</small></span>
            </label>
          </div>
          <label className="field wide">
            <span className="field-label">{mode === 'bot' ? 'Quién puede escribir al bot' : 'Tu número de WhatsApp'}</span>
            <input value={users} onChange={e => setUsers(e.target.value)} placeholder={mode === 'bot' ? '34600111222, 34600333444' : '34600111222'} inputMode="tel" autoComplete="off" />
            <span className="field-hint">Con el prefijo del país y sin el signo +{mode === 'bot' ? ', separados por comas' : ''}. Nadie más podrá usarlo.</span>
          </label>
          <button className="btn btn-primary" disabled={!valid}>Mostrar el código QR</button>
        </form>
      )}
    </div>
  )
}

export function AppsSection({ state, send }: { state: ClientState; send: Send }) {
  const [tab, setTab] = useState<'on' | 'all'>('all')
  const [q, setQ] = useState('')
  const admin = !!state.me.admin
  const apps = state.apps

  useEffect(() => { send({ t: 'apps.get' }) }, [send])

  const mine = useMemo(() => (apps ?? []).filter(a => a.state !== 'off'), [apps])
  const needle = q.trim().toLowerCase()
  const shown = (tab === 'on' ? mine : apps ?? [])
    .filter(a => !needle || a.name.toLowerCase().includes(needle) || a.about.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.state !== 'off') - Number(a.state !== 'off') || a.name.localeCompare(b.name))

  return (
    <>
      <h3>Aplicaciones</h3>
      <p className="settings-sub">Lo que conectes aquí lo pueden usar todos los bots. {admin ? '' : 'Solo un administrador puede conectar o quitar aplicaciones.'}</p>

      <div className="set-label first">Mensajería</div>
      <div className="rows">
        {admin && <Telegram state={state} send={send} />}
        {admin && <WhatsApp key={state.whatsapp ? 'wa' : 'wa-wait'} state={state} send={send} />}
      </div>

      <div className="set-label">Herramientas de trabajo</div>
      {!apps ? (
        <p className="rp-empty small">{state.hermes === 'connected' || state.hermes === 'demo' ? 'Cargando el catálogo…' : 'Hermes no está conectado ahora mismo.'}</p>
      ) : (
        <>
          <div className="apps-bar">
            <Tabs value={tab} onChange={setTab} items={[['all', `Catálogo (${apps.length})`], ['on', `Conectadas (${mine.length})`]]} />
            <label className="search apps-search">
              <IconSearch width={15} height={15} />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar: Notion, Stripe…" aria-label="Buscar aplicación" />
            </label>
          </div>
          <div className="app-grid">
            {shown.map(a => <AppTile key={a.id} app={a} admin={admin} flow={state.appAuth} send={send} />)}
          </div>
          {shown.length === 0 && <p className="rp-empty small">{tab === 'on' && !needle ? 'Todavía no hay ninguna conectada. Elige una en el catálogo.' : 'Ninguna aplicación coincide.'}</p>}
        </>
      )}
    </>
  )
}

// Nombres normales para los grupos de herramientas de Hermes.
const TOOL_NAMES: Record<string, [string, string]> = {
  web: ['Buscar en internet', 'Buscar y leer páginas web.'],
  browser: ['Usar el navegador', 'Abrir páginas, hacer clic y rellenar formularios.'],
  terminal: ['Ejecutar comandos', 'Trabajar en el ordenador del bot. Pide permiso para lo delicado.'],
  file: ['Archivos', 'Leer, crear y editar archivos.'],
  code_execution: ['Ejecutar código', 'Hacer cálculos y automatizar pasos con pequeños programas.'],
  vision: ['Ver imágenes', 'Entender las fotos y capturas que le mandáis.'],
  image_gen: ['Crear imágenes', 'Generar imágenes a partir de una descripción.'],
  tts: ['Hablar', 'Responder con audio.'],
  memory: ['Memoria', 'Recordar lo importante entre conversaciones.'],
  session_search: ['Conversaciones anteriores', 'Buscar en lo que ya habéis hablado.'],
  todo: ['Lista de tareas', 'Organizar el trabajo en pasos.'],
  cronjob: ['Rutinas', 'Programar tareas que se repiten.'],
  delegation: ['Ayudantes', 'Repartir un trabajo grande entre varios ayudantes.'],
  skills: ['Habilidades', 'Usar y aprender formas de trabajar.'],
  clarify: ['Preguntar dudas', 'Preguntaros antes de seguir cuando algo no está claro.'],
  connections: ['Aplicaciones conectadas', 'Usar las aplicaciones del apartado anterior.'],
  project: ['Proyectos', 'Mantener el contexto de cada proyecto.'],
  computer_use: ['Manejar el escritorio', 'Controlar aplicaciones de escritorio en el ordenador del bot.'],
  video_gen: ['Crear vídeos', 'Generar vídeo a partir de una descripción.'],
  video: ['Ver vídeos', 'Entender el contenido de un vídeo.'],
  x_search: ['Buscar en X', 'Leer publicaciones de X (Twitter).'],
  kanban: ['Tablero de tareas', 'Llevar tareas en columnas.'],
  search: ['Búsqueda rápida', 'Buscar en internet sin abrir páginas.']
}
const SKILL_GROUPS: Record<string, string> = {
  productivity: 'Productividad', creative: 'Creatividad', email: 'Correo', media: 'Vídeo y audio', research: 'Investigación',
  'note-taking': 'Notas', 'social-media': 'Redes sociales', 'software-development': 'Programación', web: 'Web', 'autonomous-ai-agents': 'Otros agentes'
}
const pretty = (s: string) => s.replace(/[-_]/g, ' ').replace(/^\w/, c => c.toUpperCase())

export function CapsSection({ state, send }: { state: ClientState; send: Send }) {
  const [more, setMore] = useState(false)
  const caps = state.caps
  const admin = !!state.me.admin

  useEffect(() => { send({ t: 'caps.get' }) }, [send])

  if (!caps) {
    return (
      <>
        <h3>Capacidades</h3>
        <p className="rp-empty small">{state.hermes === 'connected' || state.hermes === 'demo' ? 'Cargando…' : 'Hermes no está conectado ahora mismo.'}</p>
      </>
    )
  }

  const known = caps.toolsets.filter(t => TOOL_NAMES[t.id])
  const other = caps.toolsets.filter(t => !TOOL_NAMES[t.id])
  const row = (t: typeof caps.toolsets[number]) => (
    <label key={t.id} className="set-row">
      <div className="set-row-text">
        <span>{TOOL_NAMES[t.id]?.[0] ?? pretty(t.id)}</span>
        <small>{TOOL_NAMES[t.id]?.[1] ?? t.about}</small>
      </div>
      <input type="checkbox" className="switch" checked={t.on} disabled={!admin} onChange={e => send({ t: 'cap.toggle', id: t.id, on: e.target.checked })} aria-label={TOOL_NAMES[t.id]?.[0] ?? t.id} />
    </label>
  )
  const total = caps.skills.reduce((n, g) => n + g.items.length, 0)

  return (
    <>
      <h3>Capacidades</h3>
      <p className="settings-sub">Lo que los bots saben hacer. Apaga lo que no quieras que usen{admin ? '' : ' (solo un administrador puede cambiarlo)'}.</p>

      <div className="set-label first">Herramientas · {caps.toolsets.filter(t => t.on).length} encendidas</div>
      <div className="rows two">{known.map(row)}</div>
      {other.length > 0 && <button className="link-btn" onClick={() => setMore(m => !m)}>{more ? 'Ocultar las avanzadas' : `Herramientas avanzadas (${other.length})`}</button>}
      {more && <div className="rows two spaced">{other.map(row)}</div>}

      <div className="set-label">Habilidades · {total} instaladas</div>
      <p className="settings-sub tight">Son formas de trabajar que el bot ya conoce. Para enseñarle una nueva, explícasela en el chat y pídele que la guarde como habilidad.</p>
      <div className="skill-groups">
        {caps.skills.map(g => (
          <div key={g.group} className="skill-group">
            <span>{SKILL_GROUPS[g.group] ?? pretty(g.group)}</span>
            <div className="chips">{g.items.map(s => <i key={s} className="chip">{pretty(s)}</i>)}</div>
          </div>
        ))}
      </div>
    </>
  )
}
