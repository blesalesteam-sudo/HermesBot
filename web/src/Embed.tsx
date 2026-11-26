import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import type { ClientCommand } from '../shared/protocol'
import { Chat } from './components/Chat'
import { type Connection, connectLive } from './lib/connection'
import { reduce } from './lib/store'

/** El chat de un solo bot, para mostrarlo dentro de otra web (el CRM, canvas-ia…). */
export function Embed() {
  const params = new URLSearchParams(location.search)
  const [state, dispatch] = useReducer(reduce, null)
  const [denied, setDenied] = useState(false)
  const conn = useRef<Connection | null>(null)
  // Si la web que lo aloja nos muestra en un panel flotante, enseñamos el botón de cerrar.
  const floating = params.get('mode') !== 'inline' && window.parent !== window

  useEffect(() => {
    const theme = params.get('theme')

    if (theme === 'light' || theme === 'dark') { document.documentElement.dataset.theme = theme }

    document.documentElement.classList.add('embed')

    const query = `?widget=${encodeURIComponent(params.get('token') ?? '')}&name=${encodeURIComponent(params.get('name') ?? '')}`

    conn.current = connectLive(dispatch, () => undefined, query, () => setDenied(true))

    return () => conn.current?.close()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((cmd: ClientCommand) => conn.current?.send(cmd), [])
  const bot = state?.bots[0]

  if (denied) {
    return <div className="loading embed-off"><p>Este asistente ya no está disponible aquí.<br />Pide a un administrador de hermesBot un código nuevo.</p></div>
  }

  if (!state || !bot) {
    return <div className="loading"><span className="dots"><i /><i /><i /></span></div>
  }

  return (
    <div className="app embed-app mobile-chat">
      <Chat
        state={state}
        bot={bot}
        send={send}
        onTogglePanel={() => undefined}
        onBack={() => undefined}
        onOpenHistory={() => undefined}
        onClose={floating ? () => window.parent.postMessage({ hermesBot: 'close' }, '*') : undefined}
        prefill={null}
      />
    </div>
  )
}
