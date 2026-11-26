import { useState } from 'react'

import type { User } from '../../shared/protocol'
import { Avatar } from './Avatar'

interface Props {
  demoUsers?: User[]
  onDemoPick?: (id: string) => void
  onLoggedIn?: () => void
}

export function Login({ demoUsers, onDemoPick, onLoggedIn }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError('')

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password })
      })

      if (!res.ok) {
        setError(res.status === 429 ? 'Demasiados intentos. Espera un minuto.' : 'Usuario o contraseña incorrectos.')

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
        <span className="brand-mark big" aria-hidden="true">h</span>
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
            <p className="login-foot">Datos de prueba. En la versión real cada socio entra con su usuario y contraseña.</p>
          </>
        ) : (
          <form className="login-form" onSubmit={e => { e.preventDefault(); void submit() }}>
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Usuario" autoComplete="username" autoFocus aria-label="Usuario" />
            <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Contraseña" type="password" autoComplete="current-password" aria-label="Contraseña" />
            {error && <p className="login-error" role="alert">{error}</p>}
            <button className="btn btn-primary wide" disabled={busy || !username || !password}>{busy ? 'Entrando…' : 'Entrar'}</button>
          </form>
        )}
      </div>
    </main>
  )
}
