import { type ReactNode, useEffect, useRef, useState } from 'react'

import { USER_COLORS } from '../../shared/defaults'
import type { Bot, ClientCommand, ModelProvider, SignIn, User } from '../../shared/protocol'
import { fileSize, shortWhen } from '../lib/format'
import { canInstall, install, isInstalled, notifyBlocked, notifyOn, notifySupported, onInstallChange, setNotify } from '../lib/notify'
import type { ClientState } from '../lib/store'
import { Avatar } from './Avatar'
import { AppsSection, Badge, CapsSection, Tabs } from './SettingsApps'
import { IconBack, IconDownload, IconMoon, IconPlus, IconSun, IconTrash, IconX } from './icons'

declare const __DEMO__: boolean

export type Section = 'perfil' | 'usuarios' | 'bots' | 'modelo' | 'apps' | 'capacidades' | 'avisos' | 'copias' | 'apariencia'

interface Props {
  state: ClientState
  send: (cmd: ClientCommand) => void
  theme: 'light' | 'dark'
  onTheme: (t: 'light' | 'dark') => void
  onClose: () => void
  initial?: Section
}

const BOT_COLORS = ['#6d5bd0', '#2f9e8f', '#E78531', '#009957', '#D84F8B', '#0EA5C6', '#c0392b', '#55534e']

/** Recorta la foto en cuadrado y la deja pequeña para guardarla junto a la cuenta. */
function squarePhoto(file: File): Promise<string | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      const side = Math.min(img.width, img.height)
      const canvas = document.createElement('canvas')

      canvas.width = canvas.height = 192
      canvas.getContext('2d')?.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 192, 192)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

function UserForm({ user, me, send, onDone }: { user: User | null; me: User; send: Props['send']; onDone?: () => void }) {
  const [name, setName] = useState(user?.name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [password, setPassword] = useState('')
  const [avatar, setAvatar] = useState<string | null | undefined>(undefined)
  const [admin, setAdmin] = useState(user?.admin ?? false)
  const picker = useRef<HTMLInputElement>(null)
  const shown = avatar === undefined ? user?.avatar : avatar ?? undefined
  const self = user?.id === me.id
  const valid = name.trim() && username.trim().length >= 2 && (user ? !password || password.length >= 6 : password.length >= 6)

  return (
    <form
      className="form"
      onSubmit={e => {
        e.preventDefault()
        send({ t: 'user.save', id: user?.id, name, username, password: password || undefined, avatar, admin: me.admin && !self ? admin : undefined })
        setPassword('')
        onDone?.()
      }}
    >
      <div className="photo-row">
        <Avatar name={name || '?'} color={user?.color ?? USER_COLORS[0]!} src={shown} size={64} />
        <div className="photo-actions">
          <button type="button" className="btn" onClick={() => picker.current?.click()}>{shown ? 'Cambiar foto' : 'Subir foto'}</button>
          {shown && <button type="button" className="btn btn-danger" onClick={() => setAvatar(null)}>Quitar</button>}
        </div>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          hidden
          onChange={async e => {
            const file = e.target.files?.[0]

            e.target.value = ''
            if (file) { setAvatar(await squarePhoto(file)) }
          }}
        />
      </div>
      <div className="form-grid">
        <Field label="Nombre"><input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="Como te verán en el chat" /></Field>
        <Field label="Usuario" hint="Con este nombre se entra en la aplicación."><input value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} maxLength={32} autoComplete="off" placeholder="sin espacios" /></Field>
      </div>
      <Field label={user ? 'Contraseña nueva' : 'Contraseña'} hint={user ? 'Déjala vacía para no cambiarla. Mínimo 6 caracteres.' : 'Mínimo 6 caracteres.'}>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
      {me.admin && !self && (
        <label className="check">
          <input type="checkbox" checked={admin} onChange={e => setAdmin(e.target.checked)} />
          <span>Administrador<small>Puede crear y editar usuarios y bots.</small></span>
        </label>
      )}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={!valid}>{user ? 'Guardar cambios' : 'Crear usuario'}</button>
        {onDone && <button type="button" className="btn" onClick={onDone}>Cancelar</button>}
      </div>
    </form>
  )
}

function BotForm({ bot, send, onDone }: { bot: Bot | null; send: Props['send']; onDone: () => void }) {
  const [name, setName] = useState(bot?.name ?? '')
  const [role, setRole] = useState(bot?.role ?? '')
  const [color, setColor] = useState(bot?.color ?? BOT_COLORS[4]!)
  const [persona, setPersona] = useState(bot?.persona ?? '')

  return (
    <form className="form" onSubmit={e => { e.preventDefault(); send({ t: 'bot.save', id: bot?.id, name, role, color, persona }); onDone() }}>
      <div className="photo-row">
        <Avatar name={name || '?'} color={color} size={64} />
        <div className="swatches" role="radiogroup" aria-label="Color del bot">
          {BOT_COLORS.map(c => (
            <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={`Color ${c}`} className={`swatch${c === color ? ' on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>
      <div className="form-grid">
        <Field label="Nombre"><input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="Por ejemplo: Atención al cliente" /></Field>
        <Field label="Para qué sirve"><input value={role} onChange={e => setRole(e.target.value)} maxLength={80} placeholder="Una frase corta" /></Field>
      </div>
      <Field label="Cómo debe comportarse" hint="Explícaselo con tus palabras. Se lo decimos a Hermes al empezar la conversación con este bot.">
        <textarea value={persona} onChange={e => setPersona(e.target.value)} rows={5} maxLength={2000} placeholder="Eres el responsable de… Respondes en español, con tono…" />
      </Field>
      <div className="form-actions">
        <button className="btn btn-primary" disabled={!name.trim()}>{bot ? 'Guardar cambios' : 'Crear bot'}</button>
        <button type="button" className="btn" onClick={onDone}>Cancelar</button>
      </div>
    </form>
  )
}

// Las cuentas que casi todo el mundo usa van arriba; el resto queda en "Más proveedores".
const MAIN = ['openai-codex', 'anthropic', 'openrouter', 'gemini', 'openai-api']
const HELP: Record<string, { name?: string; what: string; keyUrl?: string; note?: string }> = {
  'openai-codex': { name: 'ChatGPT (Codex)', what: 'Usa tu suscripción de ChatGPT. Se conecta iniciando sesión, sin claves.' },
  anthropic: {
    name: 'Claude (Anthropic)',
    what: 'Los modelos Claude, con una clave de la consola de Anthropic (pago por uso).',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    note: 'La suscripción Claude Pro o Max no se puede usar aquí: Anthropic solo la permite dentro de sus propias aplicaciones.'
  },
  openrouter: { what: 'Una sola clave para usar modelos de casi todas las marcas.', keyUrl: 'https://openrouter.ai/keys' },
  gemini: { name: 'Gemini (Google)', what: 'Los modelos Gemini, con una clave de Google AI Studio.', keyUrl: 'https://aistudio.google.com/apikey' },
  'openai-api': { name: 'OpenAI (clave)', what: 'Los modelos de OpenAI con una clave de pago por uso.', keyUrl: 'https://platform.openai.com/api-keys' }
}

const providerName = (p: ModelProvider) => HELP[p.slug]?.name ?? p.name

function SignInSteps({ flow, send }: { flow: SignIn; send: Props['send'] }) {
  const [copied, setCopied] = useState(false)

  if (flow.status === 'error') {
    return (
      <div className="signin">
        <p className="login-error" role="alert">No se pudo iniciar sesión{flow.error ? ` (${flow.error})` : ''}.</p>
        <div className="form-actions">
          <button className="btn btn-primary" onClick={() => send({ t: 'login.start', slug: flow.slug })}>Volver a intentarlo</button>
          <button className="btn" onClick={() => send({ t: 'login.cancel' })}>Cerrar</button>
        </div>
      </div>
    )
  }

  if (!flow.url || !flow.code) {
    return <div className="signin"><p className="rp-empty small">Preparando el inicio de sesión…</p></div>
  }

  return (
    <div className="signin">
      <ol className="signin-steps">
        <li>
          <span>Abre la página de inicio de sesión y entra con tu cuenta.</span>
          <a className="btn btn-primary" href={flow.url} target="_blank" rel="noreferrer">Abrir la página</a>
        </li>
        <li>
          <span>Cuando te lo pida, escribe este código:</span>
          <button
            className="code-chip"
            title="Copiar el código"
            onClick={() => void navigator.clipboard?.writeText(flow.code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1400) }).catch(() => undefined)}
          >
            <b>{flow.code}</b><small>{copied ? 'Copiado' : 'Copiar'}</small>
          </button>
        </li>
        <li><span className="waiting"><span className="dots"><i /><i /><i /></span> Esperando a que termines. Esta pantalla se actualiza sola.</span></li>
      </ol>
      <button className="btn small" onClick={() => send({ t: 'login.cancel' })}>Cancelar</button>
    </div>
  )
}

function ProviderRow({ p, flow, send }: { p: ModelProvider; flow?: SignIn | null; send: Props['send'] }) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [confirm, setConfirm] = useState(false)
  const help = HELP[p.slug]
  const signing = flow && flow.slug === p.slug && flow.status !== 'done' ? flow : null

  return (
    <div className="provider">
      <div className="set-row">
        <Badge name={providerName(p)} />
        <div className="set-row-text">
          <span>{providerName(p)}{p.connected && <i className="tag ok">Conectada</i>}</span>
          <small>{p.connected ? `${p.models.length === 1 ? '1 modelo disponible' : `${p.models.length} modelos disponibles`}` : help?.what ?? 'Se conecta pegando su clave.'}</small>
        </div>
        {confirm ? (
          <>
            <button className="btn small danger" onClick={() => { send({ t: 'model.disconnect', slug: p.slug }); setConfirm(false) }}>Desconectar</button>
            <button className="btn small" onClick={() => setConfirm(false)}>Cancelar</button>
          </>
        ) : p.connected ? (
          <>
            {p.keyBased && <button className="btn small" onClick={() => setOpen(o => !o)}>Cambiar clave</button>}
            <button className="mini-btn" onClick={() => setConfirm(true)} aria-label={`Desconectar ${providerName(p)}`} title="Desconectar"><IconTrash width={15} height={15} /></button>
          </>
        ) : p.signIn ? (
          !signing && <button className="btn btn-primary small-primary" onClick={() => send({ t: 'login.start', slug: p.slug })}>Iniciar sesión</button>
        ) : p.keyBased && <button className="btn small" onClick={() => setOpen(o => !o)}>{open ? 'Cerrar' : 'Conectar'}</button>}
      </div>
      {signing && <SignInSteps flow={signing} send={send} />}
      {open && (
        <form className="key-form" onSubmit={e => { e.preventDefault(); send({ t: 'model.key', slug: p.slug, key }); setKey(''); setOpen(false) }}>
          {help?.note && <p className="key-note">{help.note}</p>}
          <div className="provider-form">
            <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={`Pega aquí la clave de ${providerName(p)}`} autoComplete="off" autoFocus aria-label={`Clave de ${providerName(p)}`} />
            <button className="btn btn-primary" disabled={key.trim().length < 8}>Guardar</button>
          </div>
          {help?.keyUrl && <a className="key-link" href={help.keyUrl} target="_blank" rel="noreferrer">¿De dónde saco la clave?</a>}
        </form>
      )}
    </div>
  )
}

/** Desplegable con los modelos de todas las cuentas conectadas, agrupados por cuenta. */
function ModelPicker({ providers, value, onChange, first, label }: { providers: ModelProvider[]; value: string; onChange: (slug: string, model: string) => void; first?: string; label: string }) {
  const known = !value || providers.some(p => p.models.some(m => `${p.slug}\n${m}` === value))

  return (
    <select
      className="model-select"
      value={value}
      aria-label={label}
      onChange={e => {
        const [slug = '', model = ''] = e.target.value.split('\n')

        onChange(slug, model)
      }}
    >
      {first !== undefined && <option value="">{first}</option>}
      {!known && <option value={value}>{value.split('\n')[1]}</option>}
      {providers.map(p => (
        <optgroup key={p.slug} label={providerName(p)}>
          {p.models.map(m => <option key={m} value={`${p.slug}\n${m}`}>{m}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

function ModelSection({ state, send }: { state: ClientState; send: Props['send'] }) {
  const [tab, setTab] = useState<'cuentas' | 'modelos'>('cuentas')
  const [q, setQ] = useState('')
  const [more, setMore] = useState(false)
  const info = state.model

  useEffect(() => { send({ t: 'model.get' }) }, [send])

  if (!info) {
    return (
      <>
        <h3>Inteligencia</h3>
        <p className="rp-empty small">{state.hermes === 'connected' || state.hermes === 'demo' ? 'Cargando…' : 'Hermes no está conectado ahora mismo.'}</p>
      </>
    )
  }

  const order = (p: ModelProvider) => (MAIN.indexOf(p.slug) === -1 ? 99 : MAIN.indexOf(p.slug))
  const mine = info.providers.filter(p => p.connected)
  const suggested = info.providers.filter(p => !p.connected && MAIN.includes(p.slug)).sort((a, b) => order(a) - order(b))
  const needle = q.trim().toLowerCase()
  const rest = info.providers.filter(p => !p.connected && !MAIN.includes(p.slug) && (!needle || p.name.toLowerCase().includes(needle)))
  const usable = mine.filter(p => p.models.length)
  const team = info.provider && info.model ? `${info.provider}\n${info.model}` : ''
  const teamName = providerName(info.providers.find(p => p.slug === info.provider) ?? { slug: '', name: info.provider, connected: false, keyBased: false, models: [] })

  return (
    <>
      <h3>Inteligencia</h3>
      <p className="settings-sub">El modelo es el motor con el que piensan los bots. Primero se conecta una cuenta y después se elige qué modelo usa cada bot.</p>

      <div className="now-card">
        <Badge name={teamName || '?'} size={40} />
        <div>
          <small>El equipo usa ahora</small>
          <b>{info.model || 'Ningún modelo todavía'}</b>
          <small>{info.model ? `Cuenta: ${teamName}` : 'Conecta una cuenta para empezar.'}</small>
        </div>
      </div>

      <Tabs value={tab} onChange={setTab} items={[['cuentas', `Cuentas (${mine.length})`], ['modelos', 'Modelos por bot']]} />

      {tab === 'cuentas' ? (
        <>
          {mine.length > 0 && (
            <>
              <div className="set-label first">Conectadas</div>
              <div className="rows">{mine.map(p => <ProviderRow key={p.slug} p={p} flow={state.login} send={send} />)}</div>
            </>
          )}
          <div className={`set-label${mine.length ? '' : ' first'}`}>Añadir una cuenta</div>
          <div className="rows">{suggested.map(p => <ProviderRow key={p.slug} p={p} flow={state.login} send={send} />)}</div>
          <button className="link-btn" onClick={() => setMore(m => !m)}>{more ? 'Ocultar el resto' : 'Ver más proveedores'}</button>
          {more && (
            <>
              <label className="search modal-search">
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar proveedor" aria-label="Buscar proveedor" />
              </label>
              <div className="rows">
                {rest.map(p => <ProviderRow key={p.slug} p={p} flow={state.login} send={send} />)}
                {rest.length === 0 && <p className="rp-empty small">Ningún proveedor coincide.</p>}
              </div>
            </>
          )}
        </>
      ) : usable.length === 0 ? (
        <p className="rp-empty small">Conecta primero una cuenta en la pestaña Cuentas.</p>
      ) : (
        <>
          <div className="set-label first">Modelo del equipo</div>
          <div className="rows">
            <div className="set-row">
              <div className="set-row-text">
                <span>Para todos los bots</span>
                <small>Lo usan los bots que no tienen uno propio.</small>
              </div>
              <ModelPicker providers={usable} value={team} label="Modelo del equipo" onChange={(slug, model) => slug && send({ t: 'model.set', slug, model })} />
            </div>
          </div>

          <div className="set-label">Modelo de cada bot</div>
          <div className="rows">
            {state.bots.map(b => (
              <div key={b.id} className="set-row">
                <Avatar name={b.name} color={b.color} size={30} />
                <div className="set-row-text">
                  <span>{b.name}</span>
                  <small>{b.model ? `Cuenta: ${providerName(info.providers.find(p => p.slug === b.model!.slug) ?? { slug: b.model.slug, name: b.model.slug, connected: false, keyBased: false, models: [] })}` : 'Usa el del equipo'}</small>
                </div>
                <ModelPicker
                  providers={usable}
                  value={b.model ? `${b.model.slug}\n${b.model.model}` : ''}
                  first="El del equipo"
                  label={`Modelo de ${b.name}`}
                  onChange={(slug, model) => send({ t: 'bot.model', id: b.id, slug: slug || undefined, model: model || undefined })}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function AlertsSection() {
  const [on, setOn] = useState(notifyOn)
  const [, refresh] = useState(0)

  useEffect(() => onInstallChange(() => refresh(n => n + 1)), [])

  return (
    <>
      <h3>Avisos y aplicación</h3>
      <p className="settings-sub">Se guarda en este dispositivo: cada persona decide en su móvil y en su ordenador.</p>
      <div className="rows">
        <label className="set-row">
          <div className="set-row-text">
            <span>Avisarme cuando pase algo</span>
            <small>{!notifySupported() ? 'Este navegador no admite avisos. En iPhone, instala primero la aplicación.' : notifyBlocked() ? 'Los avisos están bloqueados para esta página en el navegador. Permítelos en el candado de la barra de direcciones.' : 'Cuando un bot responde, pide permiso o alguien del equipo escribe y no estás mirando hermesBot.'}</small>
          </div>
          <input type="checkbox" className="switch" checked={on} disabled={!notifySupported() || notifyBlocked()} onChange={async e => setOn(await setNotify(e.target.checked))} aria-label="Avisos del navegador" />
        </label>
        <div className="set-row">
          <div className="set-row-text">
            <span>Instalar hermesBot</span>
            <small>{isInstalled() ? 'Ya la estás usando como aplicación instalada.' : canInstall() ? 'Se abre en su propia ventana, con su icono, como cualquier aplicación.' : 'En iPhone o iPad: botón Compartir y después «Añadir a pantalla de inicio». En el ordenador: el icono de instalar de la barra de direcciones (Chrome o Edge).'}</small>
          </div>
          {canInstall() && !isInstalled() && <button className="btn small" onClick={() => void install()}>Instalar</button>}
        </div>
      </div>
    </>
  )
}

function BackupSection({ state, send }: { state: ClientState; send: Props['send'] }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const info = state.backups

  useEffect(() => { send({ t: 'backup.list' }) }, [send])

  const restore = async () => {
    if (!file) { return }

    setBusy(true)
    setError('')

    try {
      const res = await fetch('/api/restore', { method: 'POST', headers: { 'content-type': 'application/gzip' }, body: file })

      if (!res.ok) {
        setError(((await res.json().catch(() => ({}))) as { error?: string }).error || 'No pude restaurar la copia.')

        return
      }

      location.reload()
    } catch {
      setError('Se cortó la conexión mientras se subía la copia.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h3>Copias de seguridad</h3>
      <p className="settings-sub">Una copia es un único archivo con todo: cuentas, bots, conversaciones, archivos y lo que Hermes ha aprendido (memoria, habilidades, rutinas y claves). Guárdalo en un sitio seguro, porque contiene vuestras claves.</p>
      <div className="rows">
        <div className="set-row">
          <div className="set-row-text">
            <span>Descargar una copia ahora</span>
            <small>Tarda unos segundos en prepararse.</small>
          </div>
          {__DEMO__
            ? <button className="btn small" disabled>Descargar</button>
            : <a className="btn small" href="/api/backup" download><IconDownload width={14} height={14} /> Descargar</a>}
        </div>
        <label className="set-row">
          <div className="set-row-text">
            <span>Copia automática diaria</span>
            <small>Cada día se guarda una copia en el servidor y se conservan las 7 últimas.</small>
          </div>
          <input type="checkbox" className="switch" checked={info?.auto ?? true} onChange={e => send({ t: 'backup.auto', on: e.target.checked })} aria-label="Copia automática diaria" />
        </label>
      </div>

      <div className="set-label">Copias guardadas en el servidor</div>
      {info?.list.length ? (
        <div className="rows">
          {info.list.map(b => (
            <div key={b.name} className="set-row">
              <div className="set-row-text">
                <span>{new Date(b.ts).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' })}</span>
                <small>{fileSize(b.size)} · {shortWhen(b.ts)}</small>
              </div>
              {!__DEMO__ && <a className="btn small" href={`/api/backup/${encodeURIComponent(b.name)}`} download>Descargar</a>}
            </div>
          ))}
        </div>
      ) : <p className="rp-empty small">{info ? 'Todavía no hay ninguna. La primera se hace sola a los pocos minutos de arrancar.' : 'Cargando…'}</p>}

      <div className="set-label">Restaurar</div>
      <div className="rows">
        <div className="set-row">
          <div className="set-row-text">
            <span>{file ? file.name : 'Volver a una copia'}</span>
            <small>{file ? 'Se sustituirá todo lo actual (cuentas, conversaciones y la memoria de Hermes) por lo que hay en la copia. Antes se guarda una copia de cómo está ahora.' : 'Sube un archivo de copia de hermesBot para dejarlo todo como estaba entonces.'}</small>
          </div>
          {file ? (
            <>
              <button className="btn small danger" disabled={busy || __DEMO__} onClick={() => void restore()}>{busy ? 'Restaurando…' : 'Restaurar'}</button>
              <button className="btn small" disabled={busy} onClick={() => setFile(null)}>Cancelar</button>
            </>
          ) : <button className="btn small" onClick={() => picker.current?.click()}>Elegir archivo</button>}
          <input ref={picker} type="file" accept=".gz,.tgz,application/gzip" hidden onChange={e => { setFile(e.target.files?.[0] ?? null); setError(''); e.target.value = '' }} />
        </div>
      </div>
      {error && <p className="login-error" role="alert">{error}</p>}
    </>
  )
}

export function Settings({ state, send, theme, onTheme, onClose, initial = 'perfil' }: Props) {
  const [section, setSection] = useState<Section>(initial)
  const [editUser, setEditUser] = useState<string | 'new' | null>(null)
  const [editBot, setEditBot] = useState<string | 'new' | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const me = state.me
  const admin = !!me.admin

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose() } }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const go = (s: Section) => { setSection(s); setEditUser(null); setEditBot(null); setConfirm(null) }
  const nav: [string, [Section, string][]][] = [
    ['Tú', [['perfil', 'Mi perfil'], ['avisos', 'Avisos y app'], ['apariencia', 'Apariencia']]],
    ['Equipo', [['usuarios', 'Usuarios'], ['bots', 'Bots']]],
    ['Conexiones', [...(admin ? [['modelo', 'Inteligencia'] as [Section, string]] : []), ['apps', 'Aplicaciones'], ['capacidades', 'Capacidades']]],
    ...(admin ? [['Sistema', [['copias', 'Copias']]] as [string, [Section, string][]]] : [])
  ]
  const userBeingEdited = editUser && editUser !== 'new' ? state.users.find(u => u.id === editUser) ?? null : null
  const botBeingEdited = editBot && editBot !== 'new' ? state.bots.find(b => b.id === editBot) ?? null : null

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Ajustes" onClick={e => e.stopPropagation()}>
        <nav className="settings-nav" aria-label="Secciones de ajustes">
          <h2>Ajustes</h2>
          {nav.map(([group, items]) => (
            <div key={group} className="nav-group">
              <span>{group}</span>
              {items.map(([id, label]) => (
                <button key={id} className={section === id ? 'on' : ''} onClick={() => go(id)} aria-current={section === id ? 'page' : undefined}>{label}</button>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-body">
          <button className="round-btn settings-close" onClick={onClose} aria-label="Cerrar"><IconX width={17} height={17} /></button>

          {section === 'perfil' && (
            <>
              <h3>Mi perfil</h3>
              <p className="settings-sub">Tu nombre y tu foto son lo que ve el resto del equipo en el chat.</p>
              <UserForm key={me.id} user={me} me={me} send={send} />
            </>
          )}

          {section === 'usuarios' && (editUser ? (
            <>
              <button className="back-link" onClick={() => setEditUser(null)}><IconBack width={15} height={15} /> Usuarios</button>
              <h3>{editUser === 'new' ? 'Nuevo usuario' : userBeingEdited?.name}</h3>
              <UserForm key={editUser} user={userBeingEdited} me={me} send={send} onDone={() => setEditUser(null)} />
            </>
          ) : (
            <>
              <h3>Usuarios</h3>
              <p className="settings-sub">{admin ? 'Las personas que pueden entrar en hermesBot. Todas comparten los mismos bots y conversaciones.' : 'Las personas con acceso a hermesBot. Solo un administrador puede añadir o quitar usuarios.'}</p>
              <div className="rows">
                {state.users.map(u => (
                  <div key={u.id} className="set-row">
                    <Avatar name={u.name} color={u.color} src={u.avatar} size={36} status={state.online.includes(u.id) ? 'online' : null} />
                    <div className="set-row-text">
                      <span>{u.name}{u.id === me.id ? ' (tú)' : ''}{u.admin && <i className="tag">Administrador</i>}</span>
                      <small>{u.username}</small>
                    </div>
                    {confirm === u.id ? (
                      <>
                        <button className="btn small danger" onClick={() => { send({ t: 'user.delete', id: u.id }); setConfirm(null) }}>Borrar cuenta</button>
                        <button className="btn small" onClick={() => setConfirm(null)}>Cancelar</button>
                      </>
                    ) : (admin || u.id === me.id) && (
                      <>
                        <button className="btn small" onClick={() => (u.id === me.id ? go('perfil') : setEditUser(u.id))}>Editar</button>
                        {admin && u.id !== me.id && <button className="mini-btn" onClick={() => setConfirm(u.id)} aria-label={`Borrar a ${u.name}`} title="Borrar"><IconTrash width={15} height={15} /></button>}
                      </>
                    )}
                  </div>
                ))}
              </div>
              {admin && <button className="btn add-btn" onClick={() => setEditUser('new')}><IconPlus width={16} height={16} /> Añadir usuario</button>}
            </>
          ))}

          {section === 'bots' && (editBot ? (
            <>
              <button className="back-link" onClick={() => setEditBot(null)}><IconBack width={15} height={15} /> Bots</button>
              <h3>{editBot === 'new' ? 'Nuevo bot' : botBeingEdited?.name}</h3>
              <BotForm key={editBot} bot={botBeingEdited} send={send} onDone={() => setEditBot(null)} />
            </>
          ) : (
            <>
              <h3>Bots</h3>
              <p className="settings-sub">Vuestro equipo de bots. Todos comparten el mismo cerebro y la misma memoria; cada uno tiene su conversación y su papel.</p>
              <div className="rows">
                {state.bots.map(b => (
                  <div key={b.id} className="set-row">
                    <Avatar name={b.name} color={b.color} size={36} />
                    <div className="set-row-text">
                      <span>{b.name}</span>
                      <small>{b.role || 'Sin descripción'}</small>
                    </div>
                    {confirm === b.id ? (
                      <>
                        <button className="btn small danger" onClick={() => { send({ t: 'bot.delete', id: b.id }); setConfirm(null) }}>Borrar bot y su chat</button>
                        <button className="btn small" onClick={() => setConfirm(null)}>Cancelar</button>
                      </>
                    ) : admin && (
                      <>
                        <button className="btn small" onClick={() => setEditBot(b.id)}>Editar</button>
                        {state.bots.length > 1 && <button className="mini-btn" onClick={() => setConfirm(b.id)} aria-label={`Borrar ${b.name}`} title="Borrar"><IconTrash width={15} height={15} /></button>}
                      </>
                    )}
                  </div>
                ))}
              </div>
              {admin && <button className="btn add-btn" onClick={() => setEditBot('new')}><IconPlus width={16} height={16} /> Crear bot</button>}
            </>
          ))}

          {section === 'modelo' && <ModelSection state={state} send={send} />}
          {section === 'apps' && <AppsSection state={state} send={send} />}
          {section === 'capacidades' && <CapsSection state={state} send={send} />}
          {section === 'avisos' && <AlertsSection />}
          {section === 'copias' && <BackupSection state={state} send={send} />}

          {section === 'apariencia' && (
            <>
              <h3>Apariencia</h3>
              <p className="settings-sub">Se guarda en este dispositivo.</p>
              <div className="theme-pick">
                <button className={theme === 'light' ? 'on' : ''} onClick={() => onTheme('light')} aria-pressed={theme === 'light'}><IconSun width={18} height={18} /> Claro</button>
                <button className={theme === 'dark' ? 'on' : ''} onClick={() => onTheme('dark')} aria-pressed={theme === 'dark'}><IconMoon width={18} height={18} /> Oscuro</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
