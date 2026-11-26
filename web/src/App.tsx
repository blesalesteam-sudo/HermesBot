import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import type { ClientCommand, ServerEvent } from '../shared/protocol'
import { AppsModal } from './components/AppsModal'
import { Chat } from './components/Chat'
import { Login } from './components/Login'
import { RightPanel } from './components/RightPanel'
import { Sidebar } from './components/Sidebar'
import { type Connection, connectLive } from './lib/connection'
import { connectDemo, DEMO_USERS } from './lib/demo'
import { reduce } from './lib/store'

declare const __DEMO__: boolean

type Theme = 'light' | 'dark'

const store = {
  get(key: string) {
    try { return localStorage.getItem(key) } catch { return null }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) { localStorage.removeItem(key) } else { localStorage.setItem(key, value) }
    } catch { /* sin almacenamiento: no pasa nada */ }
  }
}

function initialTheme(): Theme {
  const saved = store.get('hb-theme')

  if (saved === 'light' || saved === 'dark') { return saved }

  const preset = document.documentElement.dataset.theme

  if (preset === 'light' || preset === 'dark') { return preset }

  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [auth, setAuth] = useState<'checking' | 'out' | 'in'>(__DEMO__ ? 'out' : 'checking')
  const [demoUser, setDemoUser] = useState<string | null>(null)
  const [state, dispatch] = useReducer(reduce, null)
  const [activeId, setActiveId] = useState<string>(() => store.get('hb-bot') ?? 'chief-of-staff')
  const [panelOpen, setPanelOpen] = useState(() => store.get('hb-panel') === '1' && window.innerWidth > 1100)
  const [mobileChat, setMobileChat] = useState(false)
  const [appsOpen, setAppsOpen] = useState(false)
  const conn = useRef<Connection | null>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    store.set('hb-theme', theme)
  }, [theme])

  useEffect(() => {
    if (__DEMO__) { return }
    fetch('/api/me').then(r => setAuth(r.ok ? 'in' : 'out')).catch(() => setAuth('out'))
  }, [])

  useEffect(() => {
    const onEvent = (ev: ServerEvent) => dispatch(ev)

    if (__DEMO__ && demoUser) {
      conn.current = connectDemo(demoUser, onEvent)
    } else if (!__DEMO__ && auth === 'in') {
      conn.current = connectLive(onEvent, () => undefined)
    } else {
      return
    }

    return () => {
      conn.current?.close()
      conn.current = null
    }
  }, [auth, demoUser])

  const send = useCallback((cmd: ClientCommand) => conn.current?.send(cmd), [])

  const logout = async () => {
    if (__DEMO__) {
      setDemoUser(null)
      dispatch({ t: 'hermes', state: 'demo' })

      return
    }

    await fetch('/api/logout', { method: 'POST' }).catch(() => undefined)
    location.reload()
  }

  if (__DEMO__ && !demoUser) {
    return <Login demoUsers={DEMO_USERS} onDemoPick={setDemoUser} />
  }

  if (!__DEMO__ && auth === 'out') {
    return <Login onLoggedIn={() => setAuth('in')} />
  }

  if (!state) {
    return <div className="loading"><span className="dots"><i /><i /><i /></span></div>
  }

  const bot = state.bots.find(b => b.id === activeId) ?? state.bots[0]!

  return (
    <div className={`app${panelOpen ? ' with-panel' : ''}${mobileChat ? ' mobile-chat' : ''}`}>
      <Sidebar
        state={state}
        activeId={bot.id}
        onSelect={id => { setActiveId(id); store.set('hb-bot', id); setMobileChat(true) }}
        theme={theme}
        onToggleTheme={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
        onLogout={() => void logout()}
        onOpenApps={() => setAppsOpen(true)}
      />
      <Chat
        key={`${bot.id}-${mobileChat ? 'm' : 'd'}`}
        state={state}
        bot={bot}
        send={send}
        onTogglePanel={() => setPanelOpen(o => { store.set('hb-panel', o ? '0' : '1'); return !o })}
        onBack={() => setMobileChat(false)}
      />
      {panelOpen && <RightPanel state={state} bot={bot} onClose={() => { setPanelOpen(false); store.set('hb-panel', '0') }} />}
      {appsOpen && <AppsModal onClose={() => setAppsOpen(false)} />}
    </div>
  )
}
