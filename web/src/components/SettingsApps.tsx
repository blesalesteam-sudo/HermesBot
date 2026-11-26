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
        <div className="provider">
          <div className="set-row">
            <Badge name="WhatsApp" />
            <div className="set-row-text">
              <span>WhatsApp</span>
              <small>Se vincula con un código QR. Todavía no está disponible desde aquí.</small>
            </div>
            <i className="tag">En preparación</i>
          </div>
        </div>
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
