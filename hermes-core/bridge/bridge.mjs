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

import { execFile, spawn } from 'node:child_process'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
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

const HERMES_ENV = { ...process.env, NO_COLOR: '1' }
const MAX_FILE = 40 * 1024 * 1024
// Nunca se entregan a la web los archivos donde Hermes guarda claves o su estado interno.
const PRIVATE_FILE = /^(\.|auth\.json$|config\.yaml$|gateway)|\.(db|db-wal|db-shm|lock|pid|sock|pem|key)$/i

function reply(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(data))
}

const lastLine = error => String(error?.stderr || error?.message || error).trim().split('\n').pop().slice(0, 200)

// Inicio de sesión con una suscripción (sin claves): Hermes da una página y un código, la persona
// los usa en su navegador y Hermes guarda la sesión. Solo una a la vez.
const SIGN_IN = { 'openai-codex': ['auth', 'add', 'openai-codex', '--type', 'oauth', '--no-browser'] }
let login = null

function startLogin(provider) {
  login?.child?.kill()

  const child = spawn('hermes', SIGN_IN[provider], { env: { ...HERMES_ENV, PYTHONUNBUFFERED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const flow = { provider, status: 'pending', url: '', code: '', error: '', child, out: '' }

  login = flow

  const read = chunk => {
    flow.out = (flow.out + String(chunk).replace(/\x1b\[[0-9;]*m/g, '')).slice(-6000)
    flow.url ||= /https:\/\/\S+/.exec(flow.out)?.[0] ?? ''
    flow.code ||= /Enter this code:\s*(\S+)/i.exec(flow.out)?.[1] ?? ''
  }

  child.stdout.on('data', read)
  child.stderr.on('data', read)
  child.on('error', error => { flow.status = 'error'; flow.error = error.message })
  child.on('close', code => {
    if (flow.status !== 'pending') { return }

    const failed = /(Login failed|Login cancelled|timed out)[^\n]*/i.exec(flow.out)?.[0]

    flow.status = code === 0 && !failed ? 'done' : 'error'
    flow.error = flow.status === 'error' ? (failed || flow.out.trim().split('\n').pop() || 'no se pudo iniciar sesión').slice(0, 200) : ''
    log('inicio de sesión', provider, flow.status)
  })
  // Nadie espera más de un cuarto de hora con el código en pantalla.
  setTimeout(() => { if (flow.status === 'pending') { flow.status = 'error'; flow.error = 'Se acabó el tiempo.'; child.kill() } }, 15 * 60_000).unref()

  return flow
}

const loginView = () => (login ? { provider: login.provider, status: login.status, url: login.url, code: login.code, error: login.error } : { status: 'none' })

/** Órdenes internas que solo puede dar la web de hermesBot (con el token interno). */
async function admin(req, res, url) {
  // Modelo por defecto del equipo: lo guarda Hermes en su propia configuración, para que
  // las conversaciones nuevas (y los reinicios) usen el modelo elegido en Ajustes.
  if (req.method === 'POST' && url.pathname === '/admin/model') {
    let body = ''

    for await (const chunk of req) {
      body += chunk

      if (body.length > 4096) { return reply(res, 413, { ok: false }) }
    }

    const { model, provider } = JSON.parse(body)
    const safe = /^[A-Za-z0-9][A-Za-z0-9._:\/@+-]{0,199}$/

    if (!safe.test(String(model)) || !safe.test(String(provider))) {
      return reply(res, 400, { ok: false, error: 'modelo o proveedor no válido' })
    }

    for (const [key, value] of [['model.provider', provider], ['model.default', model]]) {
      await run('hermes', ['config', 'set', key, String(value)], { timeout: 60_000, env: HERMES_ENV })
    }

    log('modelo por defecto:', provider, model)

    return reply(res, 200, { ok: true })
  }

  if (url.pathname === '/admin/login') {
    if (req.method === 'POST') {
      const provider = String(url.searchParams.get('provider') || '')

      if (!SIGN_IN[provider]) { return reply(res, 400, { ok: false, error: 'proveedor sin inicio de sesión' }) }

      startLogin(provider)
    } else if (req.method === 'DELETE') {
      login?.child?.kill()
      login = null
    }

    return reply(res, 200, loginView())
  }

  // Telegram: el bot del equipo en Telegram. Se guarda en la configuración de Hermes y se reinicia para aplicarlo.
  if (url.pathname === '/admin/telegram') {
    const envFile = join(process.env.HERMES_HOME || '/opt/data', '.env')
    const current = key => {
      try { return new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(envFile, 'utf8'))?.[1]?.trim() ?? '' } catch { return '' }
    }

    if (req.method === 'GET') {
      return reply(res, 200, { connected: !!current('TELEGRAM_BOT_TOKEN'), users: current('TELEGRAM_ALLOWED_USERS') })
    }

    if (req.method === 'POST') {
      let body = ''

      for await (const chunk of req) {
        body += chunk

        if (body.length > 4096) { return reply(res, 413, { ok: false }) }
      }

      const { token, users } = JSON.parse(body)

      if (token === null) {
        await run('hermes', ['config', 'unset', 'TELEGRAM_BOT_TOKEN'], { timeout: 60_000, env: HERMES_ENV }).catch(() => undefined)
      } else {
        if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(String(token)) || !/^\d{3,}(,\d{3,})*$/.test(String(users))) {
          return reply(res, 400, { ok: false, error: 'datos de Telegram no válidos' })
        }

        await run('hermes', ['config', 'set', 'TELEGRAM_BOT_TOKEN', String(token)], { timeout: 60_000, env: HERMES_ENV })
        await run('hermes', ['config', 'set', 'TELEGRAM_ALLOWED_USERS', String(users)], { timeout: 60_000, env: HERMES_ENV })
      }

      log('Telegram', token === null ? 'desconectado' : 'configurado', '· reinicio')
      reply(res, 200, { ok: true })
      setTimeout(() => process.exit(1), 800)

      return
    }
  }

  // Un archivo que el bot ha creado (imagen, documento…), para enseñarlo en el chat.
  if (req.method === 'GET' && url.pathname === '/admin/file') {
    let file

    try {
      file = realpathSync(String(url.searchParams.get('path') || '').replace(/^~(?=\/)/, process.env.HOME || ''))
    } catch {
      return reply(res, 404, { ok: false, error: 'no existe' })
    }

    const info = statSync(file)

    if (!info.isFile() || info.size > MAX_FILE || PRIVATE_FILE.test(basename(file)) || /\/(\.ssh|\.gnupg|pairing|proc|sys|dev)\//.test(file)) {
      return reply(res, 403, { ok: false, error: 'no permitido' })
    }

    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': info.size })

    return pipeline(createReadStream(file), res)
  }

  // Copia de seguridad completa de Hermes (memoria, habilidades, rutinas, conversaciones, claves).
  if (req.method === 'GET' && url.pathname === '/admin/backup') {
    const out = join(tmpdir(), `hermes-copia-${randomUUID()}.zip`)

    try {
      await run('hermes', ['backup', '-o', out, '-k', '0'], { timeout: 600_000, maxBuffer: 8 * 1024 * 1024, env: HERMES_ENV })
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': statSync(out).size })
      await pipeline(createReadStream(out), res)
      log('copia de seguridad entregada')
    } finally {
      rmSync(out, { force: true })
    }

    return
  }

  // Restaurar una copia: se importa y el contenedor se reinicia para arrancar con ella.
  if (req.method === 'POST' && url.pathname === '/admin/restore') {
    const zip = join(tmpdir(), `hermes-restaurar-${randomUUID()}.zip`)

    let refused = ''

    try {
      await pipeline(req, createWriteStream(zip))
      // Hermes solo deja importar con el gateway parado; al terminar, el contenedor se reinicia y vuelve a arrancarlo.
      await run('hermes', ['gateway', 'stop'], { timeout: 120_000, env: HERMES_ENV }).catch(() => undefined)

      const { stdout } = await run('hermes', ['import', '--force', zip], { timeout: 600_000, maxBuffer: 8 * 1024 * 1024, env: HERMES_ENV })

      refused = /Import refused[^\n]*/.exec(stdout)?.[0] ?? ''
    } catch (error) {
      refused = lastLine(error)
    } finally {
      rmSync(zip, { force: true })
    }

    log(refused ? `la copia no se pudo restaurar: ${refused}` : 'copia restaurada', '· reinicio')
    reply(res, refused ? 500 : 200, refused ? { ok: false, error: refused.slice(0, 200) } : { ok: true })
    setTimeout(() => process.exit(1), 800)

    return
  }

  reply(res, 404, { ok: false })
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://hermes-core')

  if (url.pathname === '/health' || url.pathname === '/') {
    return reply(res, 200, { ok: true, service: 'hermes-core-bridge' })
  }

  if (url.pathname.startsWith('/admin/')) {
    if (!tokenOk(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''))) {
      res.writeHead(401)

      return void res.end()
    }

    return void admin(req, res, url).catch(error => {
      log('orden interna fallida', url.pathname, lastLine(error))

      if (res.headersSent) { res.destroy() } else { reply(res, 500, { ok: false, error: lastLine(error) }) }
    })
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
