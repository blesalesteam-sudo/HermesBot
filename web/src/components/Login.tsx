import { useState } from 'react'

import type { User } from '../../shared/protocol'
import { Avatar } from './Avatar'

interface Props {
  demoUsers?: User[]
  onDemoPick?: (id: string) => void
  onLoggedIn?: () => void
  /** Estreno: todavía no hay ninguna cuenta y se crea la del administrador. */
  setup?: boolean
}

export function Login({ demoUsers, onDemoPick, onLoggedIn, setup }: Props) {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError('')

    try {
      const res = await fetch(setup ? '/api/setup' : '/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password, name })
      })

      if (!res.ok) {
        const detail = setup ? ((await res.json().catch(() => ({}))) as { error?: string }).error : ''

        setError(res.status === 429 ? 'Demasiados intentos. Espera un minuto.' : detail || 'Usuario o contraseña incorrectos.')

        return
      }

      onLoggedIn?.()
    } catch {
      setError('No hay conexión con el servidor.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="login">
      <div className="login-card">
        <span className="brand-mark" aria-hidden="true">h</span>
        <h1>hermesBot</h1>
        <p className="login-sub">El espacio de trabajo privado del equipo</p>

        {demoUsers ? (
          <>
            <p className="login-label">Vista previa: elige con qué socio entrar</p>
            <div className="login-people">
              {demoUsers.map(u => (
                <button key={u.id} className="person" onClick={() => onDemoPick?.(u.id)}>
                  <Avatar name={u.name} color={u.color} size={56} />
                  <span>{u.name}</span>
                </button>
              ))}
            </div>
            <p className="login-foot">Datos de prueba. En la versión real cada persona entra con su usuario y contraseña, y las cuentas se crean en Ajustes.</p>
          </>
        ) : (
          <form className="login-form" onSubmit={e => { e.preventDefault(); void submit() }}>
            {setup && <p className="login-label">Estrena hermesBot: crea tu cuenta de administrador. Después podrás añadir al resto del equipo desde Ajustes.</p>}
            {setup && <input value={name} onChange={e => setName(e.target.value)} placeholder="Tu nombre" autoFocus aria-label="Tu nombre" maxLength={40} />}
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Usuario" autoComplete="username" autoFocus={!setup} aria-label="Usuario" />
            <input value={password} onChange={e => setPassword(e.target.value)} placeholder={setup ? 'Contraseña (mínimo 6 caracteres)' : 'Contraseña'} type="password" autoComplete={setup ? 'new-password' : 'current-password'} aria-label="Contraseña" />
            {error && <p className="login-error" role="alert">{error}</p>}
            <button className="btn btn-primary wide" disabled={busy || !username || !password || (setup && !name.trim())}>{busy ? 'Entrando…' : setup ? 'Crear cuenta y entrar' : 'Entrar'}</button>
          </form>
        )}
      </div>
    </main>
  )
}
