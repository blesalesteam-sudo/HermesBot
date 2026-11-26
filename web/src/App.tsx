import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'

import type { ClientCommand, ServerEvent } from '../shared/protocol'
import { AppsModal } from './components/AppsModal'
import { Chat } from './components/Chat'
import { Avatar } from './components/Avatar'
import { IconApps, IconLogout, IconMoon, IconPanel, IconSun } from './components/icons'
import { Login } from './components/Login'
import { Palette, type PaletteAction } from './components/Palette'
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
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [prefill, setPrefill] = useState<{ botId: string; text: string; n: number } | null>(null)
  // Hasta qué momento ha leído este socio cada chat (para los avisos de mensajes nuevos).
  const [seen, setSeen] = useState<Record<string, number>>(() => {
    try { return JSON.parse(store.get('hb-seen') ?? '{}') as Record<string, number> } catch { return {} }
  })
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

  const bot = state ? state.bots.find(b => b.id === activeId) ?? state.bots[0]! : null
  const activeCount = bot && state ? (state.messages[bot.id] ?? []).length : 0

  // El chat abierto cuenta como leído mientras la pestaña está a la vista.
  useEffect(() => {
    if (!bot || !state) { return }

    const mark = () => {
      if (document.visibilityState !== 'visible') { return }

      setSeen(prev => {
        const next = { ...prev, [bot.id]: Date.now() }

        // La primera vez, lo que ya había en los demás chats no cuenta como nuevo.
        for (const b of state.bots) { next[b.id] ??= Date.now() }
        store.set('hb-seen', JSON.stringify(next))

        return next
      })
    }

    mark()
    document.addEventListener('visibilitychange', mark)

    return () => document.removeEventListener('visibilitychange', mark)
  }, [bot?.id, activeCount, !!state]) // eslint-disable-line react-hooks/exhaustive-deps

  const unread = useMemo(() => {
    const out: Record<string, number> = {}

    if (!state) { return out }

    for (const b of state.bots) {
      const since = seen[b.id] ?? Infinity

      out[b.id] = (state.messages[b.id] ?? []).filter(m => m.ts > since && m.role !== 'notice' && !(m.role === 'user' && m.authorId === state.me.id) && !m.streaming).length
    }

    return out
  }, [state, seen])

  const totalUnread = bot ? Object.entries(unread).reduce((n, [id, c]) => n + (id === bot.id && document.visibilityState === 'visible' ? 0 : c), 0) : 0

  useEffect(() => {
    document.title = totalUnread ? `(${totalUnread}) hermesBot` : 'hermesBot'
  }, [totalUnread])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(o => !o)
      }
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  if (!bot) { return null }

  const select = (id: string) => { setActiveId(id); store.set('hb-bot', id); setMobileChat(true) }
  const togglePanel = () => setPanelOpen(o => { store.set('hb-panel', o ? '0' : '1'); return !o })
  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  const ask = (botId: string, text: string) => {
    select(botId)
    setPrefill({ botId, text, n: Date.now() })
  }
  const actions: PaletteAction[] = [
    ...state.bots.map(b => ({ id: `bot-${b.id}`, label: `Hablar con ${b.name}`, hint: b.role, icon: <Avatar name={b.name} color={b.color} size={22} />, run: () => select(b.id) })),
    { id: 'theme', label: theme === 'dark' ? 'Pasar a modo claro' : 'Pasar a modo oscuro', icon: theme === 'dark' ? <IconSun width={17} height={17} /> : <IconMoon width={17} height={17} />, run: toggleTheme },
    { id: 'panel', label: panelOpen ? 'Cerrar el panel de detalles' : 'Abrir el panel de detalles', hint: 'Actividad, rutinas y biblioteca', icon: <IconPanel width={17} height={17} />, run: togglePanel },
    { id: 'apps', label: 'Conectar aplicaciones', hint: 'WhatsApp, Telegram, Notion…', icon: <IconApps width={17} height={17} />, run: () => setAppsOpen(true) },
    { id: 'logout', label: 'Cerrar sesión', icon: <IconLogout width={17} height={17} />, run: () => void logout() }
  ]

  return (
    <div className={`app${panelOpen ? ' with-panel' : ''}${mobileChat ? ' mobile-chat' : ''}`}>
      <Sidebar
        state={state}
        activeId={bot.id}
        unread={unread}
        onSelect={select}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={() => void logout()}
        onOpenApps={() => setAppsOpen(true)}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      <Chat
        key={`${bot.id}-${mobileChat ? 'm' : 'd'}`}
        state={state}
        bot={bot}
        send={send}
        panelOpen={panelOpen}
        onTogglePanel={togglePanel}
        onBack={() => setMobileChat(false)}
        prefill={prefill?.botId === bot.id ? prefill : null}
      />
      {panelOpen && (
        <RightPanel
          state={state}
          bot={bot}
          send={send}
          onClose={() => { setPanelOpen(false); store.set('hb-panel', '0') }}
          onPrefill={text => ask(bot.id, text)}
        />
      )}
      {appsOpen && <AppsModal onClose={() => setAppsOpen(false)} onAsk={text => { setAppsOpen(false); ask(state.bots[0]!.id, text) }} />}
      {paletteOpen && <Palette actions={actions} onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}
