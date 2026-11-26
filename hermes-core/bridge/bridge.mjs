// hermesBot · puente seguro hacia el gateway de Hermes.
//
// El gateway oficial de Hermes (`/api/ws`, protocolo `hermes-gateway-v1`) solo acepta
// conexiones desde la propia máquina y con un "ticket" de un solo uso que se obtiene con
// `hermes gateway attach --json`. Este puente vive en el mismo contenedor que Hermes y:
//   1. Exige el token interno (HERMES_INTERNAL_TOKEN) a quien se conecte desde fuera.
//   2. Pide un ticket nuevo a Hermes para cada conexión.
//   3. Reenvía los mensajes JSON-RPC en ambos sentidos sin tocarlos.
// Así la web (otro servicio de Railway) habla el protocolo oficial completo sin exponer
// el gateway a internet.

import { execFile } from 'node:child_process'
import { timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import { promisify } from 'node:util'

import { WebSocket, WebSocketServer } from 'ws'

const run = promisify(execFile)
const PORT = Number(process.env.BRIDGE_PORT || process.env.PORT || 8080)
const HOST = process.env.BRIDGE_HOST || '::'
const TOKEN = process.env.HERMES_INTERNAL_TOKEN || ''
const PROTOCOL = 'hermes-gateway-v1'
const TOKEN_PREFIX = 'hermesbot-token.'
const MAX_QUEUED_FRAMES = 500

if (TOKEN.length < 24) {
  console.error('[bridge] Falta HERMES_INTERNAL_TOKEN (mínimo 24 caracteres). No arranco sin él.')
  process.exit(1)
}

const log = (...args) => console.log(new Date().toISOString(), '[bridge]', ...args)

function tokenOk(candidate) {
  const a = Buffer.from(candidate || '')
  const b = Buffer.from(TOKEN)

  return a.length === b.length && timingSafeEqual(a, b)
}

/** Pide a Hermes la URL local del gateway y un ticket de un solo uso. */
async function attachGrant() {
  let lastError

  for (const flags of [[], ['--recover'], ['--start']]) {
    try {
      const { stdout } = await run('hermes', ['gateway', 'attach', '--json', ...flags], {
        timeout: 90_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, NO_COLOR: '1' }
      })
      const line = stdout.trim().split('\n').filter(Boolean).pop()
      const grant = JSON.parse(line)

      if (grant.url && Array.isArray(grant.protocols)) {
        return grant
      }

      lastError = new Error(grant.message || 'Hermes no devolvió un ticket')
    } catch (error) {
      const out = error?.stdout?.toString?.() || ''

      lastError = new Error(out.trim().split('\n').pop() || error.message)
    }
  }

  throw lastError
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'hermes-core-bridge' }))

    return
  }

  // Modelo por defecto del equipo: lo guarda Hermes en su propia configuración, para que
  // las conversaciones nuevas (y los reinicios) usen el modelo elegido en Ajustes.
  if (req.method === 'POST' && req.url === '/admin/model') {
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')

    if (!tokenOk(bearer)) {
      res.writeHead(401)
      res.end()

      return
    }

    let body = ''

    req.on('data', chunk => {
      body += chunk

      if (body.length > 4096) { req.destroy() }
    })
    req.on('end', async () => {
      const reply = (code, data) => {
        res.writeHead(code, { 'content-type': 'application/json' })
        res.end(JSON.stringify(data))
      }

      try {
        const { model, provider } = JSON.parse(body)
        const safe = /^[A-Za-z0-9][A-Za-z0-9._:\/@+-]{0,199}$/

        if (!safe.test(String(model)) || !safe.test(String(provider))) {
          return reply(400, { ok: false, error: 'modelo o proveedor no válido' })
        }

        for (const [key, value] of [['model.provider', provider], ['model.default', model]]) {
          await run('hermes', ['config', 'set', key, String(value)], { timeout: 60_000, env: { ...process.env, NO_COLOR: '1' } })
        }

        log('modelo por defecto:', provider, model)
        reply(200, { ok: true })
      } catch (error) {
        reply(500, { ok: false, error: String(error?.message || error).split('\n').pop().slice(0, 200) })
      }
    })

    return
  }

  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 64 * 1024 * 1024,
  handleProtocols: protocols => (protocols.has(PROTOCOL) ? PROTOCOL : false)
})

server.on('upgrade', (req, socket, head) => {
  const offered = String(req.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map(p => p.trim())
  const tokenProto = offered.find(p => p.startsWith(TOKEN_PREFIX))
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const token = tokenProto ? tokenProto.slice(TOKEN_PREFIX.length) : bearer

  if (!req.url?.startsWith('/gateway') || !tokenOk(token) || !offered.includes(PROTOCOL)) {
    log('conexión rechazada', req.socket.remoteAddress)
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    socket.destroy()

    return
  }

  wss.handleUpgrade(req, socket, head, client => wss.emit('connection', client, req))
})

wss.on('connection', client => {
  const queue = []
  let upstream = null
  let closed = false

  const closeBoth = (code = 1011, reason = '') => {
    if (closed) {
      return
    }

    closed = true

    try { client.close(code, reason.slice(0, 120)) } catch { /* ya cerrado */ }
    try { upstream?.close() } catch { /* ya cerrado */ }
  }

  client.on('message', (data, isBinary) => {
    if (upstream?.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary })
    } else if (queue.length < MAX_QUEUED_FRAMES) {
      queue.push([data, isBinary])
    }
  })
  client.on('close', () => closeBoth(1000))
  client.on('error', () => closeBoth())

  attachGrant()
    .then(grant => {
      if (closed) {
        return
      }

      // Sin cabecera Origin y desde loopback: así lo exige el gateway.
      upstream = new WebSocket(grant.url, grant.protocols, { maxPayload: 64 * 1024 * 1024 })
      upstream.on('open', () => {
        log('conectado a Hermes', grant.endpoint?.instance_id || '')

        for (const [data, isBinary] of queue.splice(0)) {
          upstream.send(data, { binary: isBinary })
        }
      })
      upstream.on('message', (data, isBinary) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary })
        }
      })
      upstream.on('close', code => closeBoth(code === 1000 ? 1000 : 1012, 'hermes closed'))
      upstream.on('error', error => {
        log('error con Hermes:', error.message)
        closeBoth(1011, 'hermes error')
      })
    })
    .catch(error => {
      log('Hermes no está listo:', error.message)
      closeBoth(1013, 'hermes not ready')
    })
})

// Railway usa red privada IPv6; si el sistema no tiene IPv6 se usa IPv4.
server.once('error', error => {
  if (error.code === 'EAFNOSUPPORT' && HOST === '::') {
    server.listen(PORT, '0.0.0.0', () => log(`escuchando en 0.0.0.0:${PORT}`))
  } else {
    throw error
  }
})
server.listen(PORT, HOST, () => log(`escuchando en [${HOST}]:${PORT}`))
