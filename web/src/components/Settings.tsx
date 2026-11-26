import { type ReactNode, useEffect, useRef, useState } from 'react'

import { USER_COLORS } from '../../shared/defaults'
import type { Bot, ClientCommand, User } from '../../shared/protocol'
import type { ClientState } from '../lib/store'
import { Avatar } from './Avatar'
import { IconBack, IconMoon, IconPlus, IconSun, IconTrash, IconX } from './icons'

type Section = 'perfil' | 'usuarios' | 'bots' | 'apariencia'

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
  const nav: [Section, string][] = [['perfil', 'Mi perfil'], ['usuarios', 'Usuarios'], ['bots', 'Bots'], ['apariencia', 'Apariencia']]
  const userBeingEdited = editUser && editUser !== 'new' ? state.users.find(u => u.id === editUser) ?? null : null
  const botBeingEdited = editBot && editBot !== 'new' ? state.bots.find(b => b.id === editBot) ?? null : null

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-label="Ajustes" onClick={e => e.stopPropagation()}>
        <nav className="settings-nav" aria-label="Secciones de ajustes">
          <h2>Ajustes</h2>
          {nav.map(([id, label]) => (
            <button key={id} className={section === id ? 'on' : ''} onClick={() => go(id)} aria-current={section === id ? 'page' : undefined}>{label}</button>
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
