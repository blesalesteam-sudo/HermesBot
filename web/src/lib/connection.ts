import type { ClientCommand, ServerEvent } from '../../shared/protocol'

export interface Connection {
  send(cmd: ClientCommand): void
  close(): void
}

/** Conexión real: un WebSocket con el servidor de hermesBot, con reconexión automática. */
export function connectLive(onEvent: (ev: ServerEvent) => void, onState: (open: boolean) => void): Connection {
  let ws: WebSocket | null = null
  let closed = false
  let attempt = 0
  const outbox: ClientCommand[] = []

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws = new WebSocket(`${proto}//${location.host}/ws`)
    ws.onopen = () => {
      attempt = 0
      onState(true)

      for (const cmd of outbox.splice(0)) {
        ws?.send(JSON.stringify(cmd))
      }
    }
    ws.onmessage = e => {
      try {
        onEvent(JSON.parse(String(e.data)) as ServerEvent)
      } catch {
        /* mensaje ilegible: se ignora */
      }
    }
    ws.onclose = ev => {
      onState(false)

      if (ev.code === 4401) {
        location.reload()

        return
      }

      if (!closed) {
        attempt++
        setTimeout(open, Math.min(1000 * 2 ** attempt, 15000))
      }
    }
  }

  open()

  return {
    send(cmd) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(cmd))
      } else if (cmd.t !== 'typing') {
        outbox.push(cmd)
      }
    },
    close() {
      closed = true
      ws?.close()
    }
  }
}
