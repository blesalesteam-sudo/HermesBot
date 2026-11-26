// Servidor de hermesBot: sirve la web, comprueba el acceso de los dos socios y mantiene
// la conexión en vivo (WebSocket) entre sus navegadores y la sala compartida.
import { timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { WebSocketServer } from 'ws'

import type { ClientCommand } from '../shared/protocol.ts'
import { accountFromRequest, checkLogin, clearCookie, createUser, hasUsers, sessionCookie, tooManyAttempts } from './auth.ts'
import { backupPath, makeBackup, restoreBackup, startAutoBackup } from './backup.ts'
import { config } from './config.ts'
import { serveBotFile } from './files.ts'
import { Room } from './room.ts'

const DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)))
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2'
}

const room = new Room()

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise(done => {
    let raw = ''

    req.on('data', chunk => {
      raw += chunk

      if (raw.length > 200_000) { req.destroy() }
    })
    req.on('end', () => {
      try { done(JSON.parse(raw)) } catch { done({}) }
    })
    req.on('error', () => done({}))
  })
}

const clientIp = (req: IncomingMessage) =>
  String(req.headers['x-forwarded-for'] ?? '').split(',')[0]!.trim() || req.socket.remoteAddress || 'desconocida'

// Solo aceptamos acciones que vengan de la propia web (protege el login y el chat frente a otras páginas).
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin

  if (!origin) { return true }

  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
  let file = normalize(join(DIST, decodeURIComponent(path)))

  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
    // Cualquier otra dirección abre la aplicación.
    file = join(DIST, 'index.html')
  }

  if (!existsSync(file)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('La web todavía no está construida (falta ejecutar "npm run build").')

    return
  }

  const hashed = file.includes(`${join(DIST, 'assets')}`)

  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin'
  })

  if (req.method === 'HEAD') { return void res.end() }

  createReadStream(file).pipe(res)
}

const server = createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0]!

  try {
    if (path === '/health') { return json(res, 200, { ok: true }) }

    if (path === '/api/me') {
      const acc = accountFromRequest(req)

      return acc ? json(res, 200, { id: acc.id, name: acc.name }) : json(res, 401, { error: 'no_session', setup: !hasUsers() })
    }

    // Archivos creados por el bot: solo para quien tiene la sesión abierta.
    if (path.startsWith('/files/') && req.method === 'GET') {
      if (!accountFromRequest(req)) {
        res.writeHead(401)

        return void res.end()
      }

      return serveBotFile(res, path.slice('/files/'.length))
    }

    // Copias de seguridad (solo administradores): descargar una nueva o una guardada, y restaurar.
    if (path === '/api/backup' || path.startsWith('/api/backup/') || path === '/api/restore') {
      const acc = accountFromRequest(req)

      if (!acc?.admin) { return json(res, 403, { error: 'Solo un administrador puede gestionar las copias.' }) }
      if (!sameOrigin(req)) { return json(res, 403, { error: 'origin' }) }

      if (path === '/api/restore') {
        if (req.method !== 'POST') { return json(res, 405, { error: 'method' }) }

        const error = await restoreBackup(req)

        if (error) { return json(res, 400, { error }) }

        json(res, 200, { ok: true })
        console.log(`[copias] ${acc.name} restauró una copia de seguridad`)

        return void setTimeout(() => room.reload(), 300)
      }

      const stored = path.startsWith('/api/backup/') ? backupPath(decodeURIComponent(path.slice('/api/backup/'.length))) : null
      const file = stored ?? (path === '/api/backup' ? (await makeBackup()).file : null)

      if (!file) { return json(res, 404, { error: 'not_found' }) }
      if (path === '/api/backup') { room.sendBackups() }

      res.writeHead(200, {
        'content-type': 'application/gzip',
        'content-length': statSync(file).size,
        'content-disposition': `attachment; filename="${file.split('/').pop()}"`,
        'cache-control': 'no-store'
      })

      return void createReadStream(file).pipe(res)
    }

    if (path === '/api/login' && req.method === 'POST') {
      if (!sameOrigin(req)) { return json(res, 403, { error: 'origin' }) }
      if (tooManyAttempts(clientIp(req))) { return json(res, 429, { error: 'too_many' }) }

      const body = await readBody(req)
      const acc = checkLogin(String(body.username ?? ''), String(body.password ?? ''))

      return acc ? json(res, 200, { ok: true }, { 'set-cookie': sessionCookie(acc) }) : json(res, 401, { error: 'bad_login' })
    }

    // Estreno: mientras no exista ninguna cuenta, quien abre la web crea la del administrador.
    if (path === '/api/setup' && req.method === 'POST') {
      if (!sameOrigin(req)) { return json(res, 403, { error: 'origin' }) }
      if (hasUsers()) { return json(res, 409, { error: 'Ya hay una cuenta creada. Entra con tu usuario.' }) }
      if (tooManyAttempts(clientIp(req))) { return json(res, 429, { error: 'Demasiados intentos. Espera un minuto.' }) }

      const body = await readBody(req)
      const given = Buffer.from(String(body.code ?? '').trim().toLowerCase())
      const expected = Buffer.from(config.setupCode.toLowerCase())

      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        return json(res, 403, { error: 'El código de estreno no es correcto.' })
      }

      const made = createUser({ username: String(body.username ?? ''), name: String(body.name ?? ''), password: String(body.password ?? ''), admin: true })

      return made.user ? json(res, 200, { ok: true }, { 'set-cookie': sessionCookie(made.user) }) : json(res, 400, { error: made.error })
    }

    if (path === '/api/logout' && req.method === 'POST') {
      return json(res, 200, { ok: true }, { 'set-cookie': clearCookie() })
    }

    if (path.startsWith('/api/')) { return json(res, 404, { error: 'not_found' }) }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)

      return void res.end()
    }

    serveStatic(req, res, path === '/' ? '/index.html' : path)
  } catch (error) {
    console.error('[web] error', error)

    if (!res.headersSent) { json(res, 500, { error: 'server' }) }
  }
})

const wss = new WebSocketServer({ noServer: true, maxPayload: 80 * 1024 * 1024 })

server.on('upgrade', (req, socket, head) => {
  if ((req.url || '').split('?')[0] !== '/ws' || !sameOrigin(req)) {
    return void socket.destroy()
  }

  wss.handleUpgrade(req, socket, head, ws => {
    const account = accountFromRequest(req)

    if (!account) {
      // El navegador vuelve a la pantalla de entrada cuando recibe este código.
      return void ws.close(4401, 'no_session')
    }

    const viewer = room.join(account, ev => {
      if (ws.readyState === ws.OPEN) { ws.send(JSON.stringify(ev)) }
    }, () => ws.close(4401, 'no_session'))
    let alive = true
    const beat = setInterval(() => {
      if (!alive) { return void ws.terminate() }

      alive = false
      ws.ping()
    }, 30_000)

    ws.on('pong', () => { alive = true })
    ws.on('message', data => {
      alive = true

      try {
        const cmd = JSON.parse(String(data)) as ClientCommand

        if (cmd && typeof cmd.t === 'string') {
          void room.handle(viewer, cmd).catch(error => console.error('[web] orden fallida', cmd.t, error))
        }
      } catch {
        /* mensaje ilegible: se ignora */
      }
    })
    ws.on('close', () => {
      clearInterval(beat)
      room.leave(viewer)
    })
    ws.on('error', () => undefined)
  })
})

const ready = () => {
  console.log(`[web] hermesBot escuchando en el puerto ${config.port}. ${hasUsers() ? 'Cuentas creadas.' : 'Sin cuentas todavía.'}`)

  if (!hasUsers()) {
    console.log(config.setupCodeFromEnv
      ? '[web] Para crear la primera cuenta hace falta el código de estreno (la variable SETUP_CODE).'
      : `[web] CÓDIGO DE ESTRENO para crear la primera cuenta: ${config.setupCode}`)
  }

  room.start()
  startAutoBackup()
}

// Railway usa red interna IPv6; si la máquina no la tiene, escuchamos en IPv4.
server.once('error', (error: NodeJS.ErrnoException) => {
  if (error.code !== 'EAFNOSUPPORT') { throw error }

  server.listen(config.port, '0.0.0.0')
})
server.once('listening', ready)
server.listen(config.port, '::')
