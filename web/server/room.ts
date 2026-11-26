// La "sala" compartida: guarda lo que ven los dos socios, lo reparte en vivo a todos los
// navegadores conectados y habla con Hermes a través del cliente oficial del gateway
// (protocolo hermes-gateway-v1, JSON-RPC por WebSocket).
import { randomUUID } from 'node:crypto'

import type {
  ApprovalChoice, Attachment, Bot, BotStatus, ChatMessage, ClientCommand, HermesState, PendingRequest, Routine, ServerEvent,
  Snapshot, ToolCall, Upload, User
} from '../shared/protocol.ts'
import { createUser, deleteUser, findUser, publicUser, publicUsers, updateUser } from './auth.ts'
import { config } from './config.ts'
import { persist, saved, type StoredUser } from './store.ts'
import { GatewayClient } from './vendor/hermes-shared/node/gateway-client.ts'

type Send = (ev: ServerEvent) => void

interface Viewer {
  user: User
  send: Send
  close: () => void
}

interface HermesEvent {
  type: string
  session_id?: string
  payload?: Record<string, any>
}

interface SharedPrompt {
  session_id: string
  prompt_id: string
  execution_generation: number
  kind: 'approval' | 'clarify'
}

// Nombres de herramientas de Hermes → frases en lenguaje normal.
const TOOL_LABELS: Record<string, string> = {
  terminal: 'Ejecutó un comando', process: 'Gestionó un proceso', execute_code: 'Ejecutó código',
  read_file: 'Leyó un archivo', write_file: 'Escribió un archivo', patch: 'Editó un archivo', search_files: 'Buscó en los archivos',
  web_search: 'Buscó en la web', web_extract: 'Leyó una página web', browser_navigate: 'Abrió una página web',
  browser_click: 'Hizo clic en una página', browser_type: 'Escribió en una página', browser_snapshot: 'Miró una página web',
  browser_exec: 'Usó el navegador', vision_analyze: 'Analizó una imagen', image_generate: 'Creó una imagen',
  memory: 'Consultó la memoria del equipo', session_search: 'Revisó conversaciones anteriores', todo: 'Organizó la lista de tareas',
  clarify: 'Hizo una pregunta', delegate_task: 'Encargó una tarea a un ayudante', cronjob: 'Gestionó una rutina',
  send_message: 'Envió un mensaje', text_to_speech: 'Generó un audio', skill_view: 'Consultó una habilidad',
  skills_list: 'Revisó sus habilidades', skill_manage: 'Actualizó una habilidad'
}

function toolLabel(name: string): string {
  if (TOOL_LABELS[name]) { return TOOL_LABELS[name]! }
  if (name.startsWith('browser_')) { return 'Usó el navegador' }
  if (name.startsWith('mcp_')) { return `Usó ${name.slice(4).replace(/_/g, ' ')}` }

  return `Usó ${name.replace(/_/g, ' ')}`
}

const MAX_UPLOADS = 6
const MAX_UPLOAD_CHARS = 11_500_000 // unos 8 MB una vez codificado

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** Traduce el horario de Hermes ("0 9 * * 1-5", "every 30m"…) a una frase normal. */
export function humanSchedule(raw: string): string {
  const s = raw.trim()
  const every = /^every\s+(\d+)\s*(m|min|h|d)\w*$/i.exec(s)

  if (every) {
    const n = Number(every[1])
    const unit = every[2]!.toLowerCase().startsWith('m') ? ['minuto', 'minutos'] : every[2]!.toLowerCase() === 'h' ? ['hora', 'horas'] : ['día', 'días']

    return n === 1 ? `Cada ${unit[0]}` : `Cada ${n} ${unit[1]}`
  }

  const cron = /^(\d{1,2})\s+(\d{1,2})\s+(\S+)\s+(\S+)\s+(\S+)$/.exec(s)

  if (cron) {
    const [, mm, hh, dom, mon, dow] = cron
    const time = `a las ${Number(hh)}:${mm!.padStart(2, '0')}`

    if (dom === '*' && mon === '*') {
      if (dow === '*') { return `Todos los días ${time}` }
      if (dow === '1-5') { return `De lunes a viernes ${time}` }
      if (dow === '0,6' || dow === '6,0') { return `Fines de semana ${time}` }
      if (/^[0-7](,[0-7])*$/.test(dow!)) {
        const names = dow!.split(',').map(d => DAYS[Number(d) % 7]!)

        return `${names.length === 1 ? 'Cada' : 'Los'} ${names.join(', ').replace(/, ([^,]*)$/, ' y $1')} ${time}`
      }
    }

    if (/^\d+$/.test(dom!) && mon === '*' && dow === '*') { return `El día ${dom} de cada mes ${time}` }
  }

  return s
}


export class Room {
  private viewers = new Set<Viewer>()
  private status: Record<string, BotStatus> = {}
  private requests = new Map<string, PendingRequest>()
  private prompts = new Map<string, SharedPrompt>()
  private typing = new Map<string, NodeJS.Timeout>()
  private hermes: HermesState = 'connecting'
  private hermesDetail = ''
  private sessionToBot = new Map<string, string>()
  private attaching = new Map<string, Promise<string>>()
  private current = new Map<string, ChatMessage>()
  private lastSegment = new Map<string, number>()
  private gw: GatewayClient | null = null
  private routines: Routine[] = []
  private bots: Bot[] = saved.bots ?? config.bots

  private get users(): User[] {
    return publicUsers()
  }

  constructor() {
    for (const bot of this.bots) {
      saved.messages[bot.id] ??= []
      this.status[bot.id] = { state: 'idle', lastActive: saved.lastActive[bot.id] }
    }

    for (const [botId, sid] of Object.entries(saved.sessions)) {
      this.sessionToBot.set(sid, botId)
    }
  }

  // ───────────── Navegadores ─────────────

  join(account: StoredUser, send: Send, close: () => void): Viewer {
    const viewer: Viewer = { user: publicUser(account), send, close }

    this.viewers.add(viewer)
    send({ t: 'hello', snapshot: this.snapshot(viewer.user) })
    this.broadcast({ t: 'online', users: this.online() })

    return viewer
  }

  leave(viewer: Viewer) {
    this.viewers.delete(viewer)

    for (const bot of this.bots) {
      this.setTyping(bot.id, viewer.user.id, false)
    }

    this.broadcast({ t: 'online', users: this.online() })
  }

  private online(): string[] {
    return [...new Set([...this.viewers].map(v => v.user.id))]
  }

  private snapshot(me: User): Snapshot {
    return {
      me,
      users: this.users,
      bots: this.bots,
      messages: saved.messages,
      status: this.status,
      requests: [...this.requests.values()],
      online: this.online(),
      hermes: this.hermes,
      hermesDetail: this.hermesDetail,
      routines: this.routines
    }
  }

  private broadcast(ev: ServerEvent, except?: Viewer) {
    for (const v of this.viewers) {
      if (v !== except) {
        try { v.send(ev) } catch { /* navegador ya desconectado */ }
      }
    }
  }

  private putMessage(botId: string, msg: ChatMessage) {
    const list = (saved.messages[botId] ??= [])
    const i = list.findIndex(m => m.id === msg.id)

    if (i === -1) { list.push(msg) } else { list[i] = msg }

    this.broadcast({ t: 'msg', botId, msg })
    persist()
  }

  private notice(botId: string, text: string, error = false) {
    this.putMessage(botId, { id: randomUUID(), role: 'notice', text, error, ts: Date.now() })
  }

  private setStatus(botId: string, status: BotStatus) {
    const prev = this.status[botId]

    if (prev && prev.state === status.state && prev.label === status.label) { return }

    this.status[botId] = status.state === 'idle' ? { ...status, lastActive: status.lastActive ?? prev?.lastActive } : status
    this.broadcast({ t: 'status', botId, status: this.status[botId]! })
  }

  private setTyping(botId: string, userId: string, on: boolean, from?: Viewer) {
    const key = `${botId}:${userId}`
    const had = this.typing.has(key)

    clearTimeout(this.typing.get(key))
    this.typing.delete(key)

    if (on) {
      this.typing.set(key, setTimeout(() => this.setTyping(botId, userId, false), 6000))
    }

    if (on !== had) {
      this.broadcast({ t: 'typing', botId, userId, on }, from)
    }
  }

  async handle(viewer: Viewer, cmd: ClientCommand) {
    switch (cmd.t) {
      case 'typing':
        if (this.bot(cmd.botId)) { this.setTyping(cmd.botId, viewer.user.id, !!cmd.on, viewer) }

        return
      case 'send':
        return this.sendPrompt(viewer.user, cmd.botId, String(cmd.text ?? ''), Array.isArray(cmd.uploads) ? cmd.uploads : [])
      case 'routine':
        return this.manageRoutine(String(cmd.id), cmd.action)
      case 'stop':
        return this.stop(cmd.botId)
      case 'approve':
        return this.answer(cmd.reqId, viewer.user, { choice: cmd.choice })
      case 'clarify':
        return this.answer(cmd.reqId, viewer.user, { answer: cmd.answer ?? '' })
      case 'user.save':
        return this.saveUser(viewer, cmd)
      case 'user.delete':
        return this.removeUser(viewer, String(cmd.id))
      case 'bot.save':
        return this.saveBot(viewer, cmd)
      case 'bot.delete':
        return this.removeBot(viewer, String(cmd.id))
      default:
        return
    }
  }

  // ───────────── Ajustes: usuarios y bots ─────────────

  private isAdmin(viewer: Viewer): boolean {
    return !!findUser(viewer.user.id)?.admin
  }

  private usersChanged() {
    for (const v of this.viewers) {
      const fresh = findUser(v.user.id)

      if (fresh) { v.user = publicUser(fresh) }
    }

    this.broadcast({ t: 'users', users: this.users })
  }

  private saveUser(viewer: Viewer, cmd: Extract<ClientCommand, { t: 'user.save' }>) {
    const admin = this.isAdmin(viewer)
    const self = cmd.id === viewer.user.id

    if (!admin && !self) {
      return viewer.send({ t: 'toast', text: 'Solo un administrador puede gestionar usuarios.', error: true })
    }

    const input = {
      username: typeof cmd.username === 'string' ? cmd.username : undefined,
      name: typeof cmd.name === 'string' ? cmd.name : undefined,
      avatar: cmd.avatar === null || typeof cmd.avatar === 'string' ? cmd.avatar : undefined,
      password: typeof cmd.password === 'string' && cmd.password ? cmd.password : undefined,
      // Nadie se da permisos a sí mismo: el papel de administrador solo lo cambia un administrador.
      admin: admin && typeof cmd.admin === 'boolean' ? cmd.admin : undefined
    }
    const result = cmd.id ? updateUser(String(cmd.id), input) : createUser(input)

    if (result.error) {
      return viewer.send({ t: 'toast', text: result.error, error: true })
    }

    if (cmd.id && input.password) {
      // Con contraseña nueva, los demás dispositivos de esa cuenta tienen que volver a entrar.
      for (const v of [...this.viewers]) {
        if (v.user.id === cmd.id && v !== viewer) { v.close() }
      }
    }

    this.usersChanged()
    viewer.send({ t: 'toast', text: cmd.id ? 'Cambios guardados.' : `Cuenta de ${result.user!.name} creada.` })
  }

  private removeUser(viewer: Viewer, id: string) {
    if (!this.isAdmin(viewer)) {
      return viewer.send({ t: 'toast', text: 'Solo un administrador puede borrar usuarios.', error: true })
    }

    if (id === viewer.user.id) {
      return viewer.send({ t: 'toast', text: 'No puedes borrar tu propia cuenta.', error: true })
    }

    const error = deleteUser(id)

    if (error) {
      return viewer.send({ t: 'toast', text: error, error: true })
    }

    for (const v of [...this.viewers]) {
      if (v.user.id === id) { v.close() }
    }

    this.usersChanged()
    viewer.send({ t: 'toast', text: 'Cuenta borrada.' })
  }

  private saveBot(viewer: Viewer, cmd: Extract<ClientCommand, { t: 'bot.save' }>) {
    if (!this.isAdmin(viewer)) {
      return viewer.send({ t: 'toast', text: 'Solo un administrador puede gestionar los bots.', error: true })
    }

    const name = String(cmd.name ?? '').trim().slice(0, 40)

    if (!name) {
      return viewer.send({ t: 'toast', text: 'El bot necesita un nombre.', error: true })
    }

    const data = {
      name,
      role: String(cmd.role ?? '').trim().slice(0, 80),
      color: /^#[0-9a-fA-F]{6}$/.test(String(cmd.color)) ? String(cmd.color) : '#6d5bd0',
      persona: String(cmd.persona ?? '').trim().slice(0, 2000) || undefined
    }
    const existing = cmd.id ? this.bot(String(cmd.id)) : undefined

    if (cmd.id && !existing) {
      return viewer.send({ t: 'toast', text: 'Ese bot ya no existe.', error: true })
    }

    if (existing) {
      this.bots = this.bots.map(b => (b.id === existing.id ? { ...b, ...data } : b))
    } else {
      const id = `bot-${randomUUID().slice(0, 8)}`

      this.bots = [...this.bots, { id, ...data }]
      saved.messages[id] = []
      this.status[id] = { state: 'idle' }
    }

    saved.bots = this.bots
    persist()
    this.broadcast({ t: 'bots', bots: this.bots })
    viewer.send({ t: 'toast', text: existing ? 'Cambios guardados.' : `${name} ya está en el equipo.` })
  }

  private removeBot(viewer: Viewer, id: string) {
    if (!this.isAdmin(viewer)) {
      return viewer.send({ t: 'toast', text: 'Solo un administrador puede gestionar los bots.', error: true })
    }

    if (!this.bot(id) || this.bots.length === 1) {
      return viewer.send({ t: 'toast', text: 'Tiene que quedar al menos un bot.', error: true })
    }

    this.bots = this.bots.filter(b => b.id !== id)
    saved.bots = this.bots

    // Se olvida su conversación en esta web; la memoria común de Hermes no se toca.
    const sid = saved.sessions[id]

    if (sid) { this.sessionToBot.delete(sid) }
    delete saved.sessions[id]
    delete saved.messages[id]
    delete saved.lastActive[id]
    delete this.status[id]
    this.attaching.delete(id)
    persist()
    this.broadcast({ t: 'bots', bots: this.bots })
    viewer.send({ t: 'toast', text: 'Bot borrado.' })
  }

  private bot(id: string): Bot | undefined {
    return this.bots.find(b => b.id === id)
  }

  // ───────────── Hermes ─────────────

  start() {
    if (!config.hermesUrl || !config.hermesToken) {
      this.setHermes('offline', 'Faltan HERMES_CORE_URL o HERMES_INTERNAL_TOKEN en las variables del servicio.')

      return
    }

    const gw = new GatewayClient({
      // El puente de hermes-core pide el ticket a Hermes; aquí solo presentamos el token interno.
      connect: async () => ({
        url: config.hermesUrl,
        protocols: ['hermes-gateway-v1', `hermesbot-token.${config.hermesToken}`],
        profile_id: 'default',
        instance_id: 'hermes-core'
      }),
      client: { name: 'hermesbot-web', version: '0.1.0' },
      startupTimeoutMs: 30_000,
      onLifecycle: line => console.log('[hermes]', line)
    })

    this.gw = gw
    gw.on('event', (ev: HermesEvent) => {
      try {
        this.onHermesEvent(ev)
      } catch (error) {
        console.error('[hermes] evento no procesado', ev.type, error)
      }
    })
    // Peticiones directas del gateway (contraseñas, lecturas de pantalla…): esta web todavía no
    // las muestra, así que se rechazan al momento para que el agente no se quede esperando.
    gw.on('request', (req: { method: string; fail: (code: number, message: string) => void }) => {
      console.log('[hermes] petición no soportada:', req.method)
      req.fail(-32601, 'not supported by hermesbot-web')
    })
    gw.on('exit', () => this.setHermes('connecting', 'Se perdió la conexión con Hermes. Reintentando…'))
    gw.start()
    gw.drain()
  }

  private setHermes(state: HermesState, detail = '') {
    if (this.hermes === state && this.hermesDetail === detail) { return }

    this.hermes = state
    this.hermesDetail = detail
    this.broadcast({ t: 'hermes', state, detail })
  }

  private async onReady() {
    const gw = this.gw!

    // Avisamos de que esta web sabe responder a aprobaciones y preguntas: sin esto, Hermes
    // las daría por no contestadas en vez de enseñarlas como tarjetas.
    await gw.request('client.capabilities', { server_requests: true }).catch(() => undefined)
    this.setHermes('connected')
    void this.refreshRoutines()

    // Volvemos a engancharnos a la conversación de cada bot para recibir sus eventos en vivo.
    this.attaching.clear()

    for (const bot of this.bots) {
      if (saved.sessions[bot.id]) {
        void this.ensureSession(bot).catch(error => console.error('[hermes] no pude retomar', bot.id, error?.message))
      }
    }
  }

  /** Devuelve la conversación de Hermes de un bot; la retoma o la crea si hace falta. */
  private ensureSession(bot: Bot): Promise<string> {
    const pending = this.attaching.get(bot.id)

    if (pending) { return pending }

    const flight = (async () => {
      const gw = this.gw

      if (!gw) { throw new Error('Hermes no está configurado') }

      const known = saved.sessions[bot.id]

      if (known) {
        try {
          const snap = await gw.request<any>('session.resume', { session_id: known })

          this.afterAttach(bot, known, snap)

          return known
        } catch (error) {
          console.warn('[hermes] no pude retomar la conversación de', bot.id, (error as Error).message)
        }
      }

      const created = await gw.request<any>('session.create', { title: `hermesBot · ${bot.name}` })
      const sid = String(created.session_id)

      saved.sessions[bot.id] = sid
      this.sessionToBot.set(sid, bot.id)
      persist()
      this.afterAttach(bot, sid, created)

      return sid
    })()

    this.attaching.set(bot.id, flight)
    flight.catch(() => this.attaching.delete(bot.id))

    return flight
  }

  private afterAttach(bot: Bot, sid: string, snap: any) {
    this.sessionToBot.set(sid, bot.id)

    const running = !!(snap?.running ?? snap?.info?.running)

    if (!running) {
      // Si la web se reinició a mitad de una respuesta, cerramos lo que quedó abierto.
      this.finishMessage(bot.id)
      this.setStatus(bot.id, { state: 'idle', lastActive: saved.lastActive[bot.id] })

      for (const [id, p] of this.prompts) {
        if (p.session_id === sid) { this.dropRequest(id) }
      }
    } else {
      this.setStatus(bot.id, { state: 'working', label: 'Trabajando…' })
    }
  }

  private async sendPrompt(user: User, botId: string, raw: string, rawUploads: Upload[] = []) {
    const bot = this.bot(botId)
    const text = raw.trim().slice(0, 20_000)
    const uploads = rawUploads
      .filter(u => u && typeof u.data === 'string' && u.data.startsWith('data:') && u.data.length <= MAX_UPLOAD_CHARS)
      .slice(0, MAX_UPLOADS)

    if (!bot || (!text && !uploads.length)) { return }

    const attachments: Attachment[] = uploads.map(u => ({
      id: randomUUID(),
      name: String(u.name || 'archivo').slice(0, 120),
      kind: String(u.type).startsWith('image/') ? 'image' : 'file',
      size: Number(u.size) || 0,
      preview: typeof u.preview === 'string' && u.preview.startsWith('data:image/') && u.preview.length < 200_000 ? u.preview : undefined
    }))

    this.setTyping(botId, user.id, false)
    this.putMessage(botId, { id: randomUUID(), role: 'user', authorId: user.id, text, attachments: attachments.length ? attachments : undefined, ts: Date.now() })

    if (rawUploads.length > uploads.length) {
      this.notice(botId, 'Algún archivo no se pudo adjuntar: el máximo son 6 archivos de 8 MB cada uno.', true)
    }

    if (this.hermes !== 'connected' || !this.gw) {
      this.notice(botId, 'Hermes no está conectado ahora mismo. Vuelve a intentarlo en unos segundos.', true)

      return
    }

    const firstTurn = !saved.sessions[botId]

    try {
      this.setStatus(botId, { state: 'thinking', label: uploads.length ? 'Recibiendo los archivos…' : 'Pensando…' })

      const sid = await this.ensureSession(bot)
      const refs: string[] = []

      // Los adjuntos se entregan a Hermes antes del mensaje: las imágenes las "ve" y los archivos los puede abrir.
      for (const [i, u] of uploads.entries()) {
        const name = attachments[i]!.name

        try {
          if (attachments[i]!.kind === 'image') {
            await this.gw.request('image.attach_bytes', { session_id: sid, content_base64: u.data.slice(u.data.indexOf(',') + 1), filename: name })
          } else {
            const res = await this.gw.request<any>('file.attach', { session_id: sid, data_url: u.data, name })

            if (res?.ref_text) { refs.push(String(res.ref_text)) }
          }
        } catch (error) {
          console.warn('[hermes] adjunto rechazado:', name, (error as Error).message)
          this.notice(botId, `Hermes no pudo recibir "${name}".`, true)
        }
      }

      this.setStatus(botId, { state: 'thinking', label: 'Pensando…' })

      // Hermes recibe siempre quién habla (texto para el modelo), pero el mensaje guardado queda limpio.
      const persona = firstTurn && bot.persona
        ? `[Contexto del equipo: ${bot.persona} En este chat te escriben varias personas del equipo (${this.users.map(u => u.name).join(', ')}); cada mensaje indica quién lo escribe.]\n\n`
        : ''
      const body = [text || 'Mira lo que te adjunto.', ...refs].join('\n')

      await this.gw.request('prompt.submit', {
        session_id: sid,
        text: body,
        api_text: `${persona}[Mensaje de ${user.name}]\n${body}`,
        submission_id: randomUUID(),
        queued: true,
        turn_author: { id: user.id, name: user.name }
      })
    } catch (error) {
      console.error('[hermes] envío fallido:', error)
      this.setStatus(botId, { state: 'idle' })
      this.notice(botId, `No pude entregar el mensaje a Hermes (${(error as Error).message}).`, true)
    }
  }

  // ───────────── Rutinas (tareas programadas de Hermes) ─────────────

  private async refreshRoutines() {
    if (!this.gw || this.hermes !== 'connected') { return }

    try {
      const res = await this.gw.request<any>('cron.manage', { action: 'list', include_disabled: true })
      const next: Routine[] = (res?.jobs ?? []).map((j: any) => ({
        id: String(j.job_id),
        name: String(j.name || 'Rutina'),
        when: humanSchedule(String(j.schedule ?? '')),
        what: String(j.prompt_preview || j.skill || '').slice(0, 200),
        enabled: j.enabled !== false && j.state !== 'paused'
      }))

      if (JSON.stringify(next) !== JSON.stringify(this.routines)) {
        this.routines = next
        this.broadcast({ t: 'routines', routines: next })
      }
    } catch (error) {
      console.warn('[hermes] no pude leer las rutinas:', (error as Error).message)
    }
  }

  private async manageRoutine(id: string, action: 'pause' | 'resume' | 'remove') {
    if (!this.gw || !['pause', 'resume', 'remove'].includes(action) || !this.routines.some(r => r.id === id)) { return }

    try {
      await this.gw.request('cron.manage', { action, name: id })
    } catch (error) {
      console.warn('[hermes] rutina:', (error as Error).message)
    }

    await this.refreshRoutines()
  }

  private async stop(botId: string) {
    const sid = saved.sessions[botId]

    if (sid && this.gw) {
      await this.gw.request('session.interrupt', { session_id: sid }).catch(error => console.warn('[hermes] stop:', error?.message))
    }
  }

  private async answer(reqId: string, user: User, body: { choice?: ApprovalChoice; answer?: string }) {
    const prompt = this.prompts.get(reqId)

    if (!prompt || !this.gw) {
      this.dropRequest(reqId)

      return
    }

    const control = { session_id: prompt.session_id, prompt_id: prompt.prompt_id, execution_generation: prompt.execution_generation }

    try {
      if (prompt.kind === 'approval') {
        await this.gw.request('approval.respond', { ...control, choice: body.choice ?? 'deny' })
      } else {
        await this.gw.request('clarify.respond', { ...control, answer: body.answer ?? '' })
      }

      const botId = this.sessionToBot.get(prompt.session_id)

      if (botId && prompt.kind === 'approval') {
        this.notice(botId, `${user.name} ${body.choice === 'deny' ? 'denegó' : 'permitió'} la acción.`)
      }
    } catch (error) {
      console.warn('[hermes] respuesta a la tarjeta:', (error as Error).message)
    }

    this.dropRequest(reqId)
  }

  private dropRequest(id: string) {
    this.prompts.delete(id)

    if (this.requests.delete(id)) {
      this.broadcast({ t: 'req.done', id })
    }
  }

  private currentMessage(botId: string): ChatMessage {
    let msg = this.current.get(botId)

    if (!msg) {
      msg = { id: randomUUID(), role: 'assistant', text: '', tools: [], streaming: true, ts: Date.now() }
      this.current.set(botId, msg)
      this.putMessage(botId, msg)
    }

    return msg
  }

  private finishMessage(botId: string, finalText?: string, error = false) {
    const msg = this.current.get(botId)

    this.current.delete(botId)
    this.lastSegment.delete(botId)

    if (!msg) {
      if (finalText?.trim()) {
        this.putMessage(botId, { id: randomUUID(), role: 'assistant', text: finalText, ts: Date.now(), error })
      }

      return
    }

    msg.streaming = false
    msg.error = error || undefined

    if (!msg.text.trim() && finalText?.trim()) { msg.text = finalText }

    for (const t of msg.tools ?? []) {
      if (t.status === 'running') { t.status = 'done' }
    }

    if (!msg.text.trim() && !msg.tools?.length) {
      // Turno sin contenido (por ejemplo, detenido antes de empezar): no dejamos una burbuja vacía.
      saved.messages[botId] = (saved.messages[botId] ?? []).filter(m => m.id !== msg.id)
      persist()
      this.broadcast({ t: 'msg.gone', botId, id: msg.id })

      return
    }

    this.putMessage(botId, msg)
  }

  private onHermesEvent(ev: HermesEvent) {
    const p = ev.payload ?? {}

    switch (ev.type) {
      case 'gateway.ready':
        void this.onReady()

        return
      case 'gateway.reconnecting':
        this.setHermes('connecting', 'Reconectando con Hermes…')

        return
      case 'gateway.start_timeout':
        this.setHermes('offline', String(p.stderr_tail || 'Hermes no responde.').slice(0, 300))

        return
    }

    const botId = ev.session_id ? this.sessionToBot.get(ev.session_id) : undefined

    if (!botId) { return }

    switch (ev.type) {
      case 'message.start':
        this.setStatus(botId, { state: 'thinking', label: 'Pensando…' })
        break

      case 'thinking.delta':
      case 'reasoning.delta':
        if (this.status[botId]?.state === 'idle') { this.setStatus(botId, { state: 'thinking', label: 'Pensando…' }) }
        break

      case 'message.delta': {
        const piece = String(p.text ?? '')

        if (!piece) { break }

        const msg = this.currentMessage(botId)
        const segment = Number(p.segment ?? 0)
        const prev = this.lastSegment.get(botId)
        // Un "segmento" nuevo es texto que llega después de usar herramientas: lo separamos en otro párrafo.
        const glue = prev !== undefined && prev !== segment && msg.text && !msg.text.endsWith('\n') ? '\n\n' : ''

        this.lastSegment.set(botId, segment)
        msg.text += glue + piece
        this.broadcast({ t: 'delta', botId, id: msg.id, text: glue + piece })
        this.setStatus(botId, { state: 'working', label: 'Escribiendo…' })
        break
      }

      case 'tool.start': {
        const msg = this.currentMessage(botId)
        const name = String(p.name ?? p.tool_name ?? 'herramienta')
        const id = String(p.tool_id ?? p.tool_call_id ?? randomUUID())
        const tool: ToolCall = { id, name, label: toolLabel(name), status: 'running', detail: p.context ? String(p.context).slice(0, 160) : undefined }

        msg.tools = [...(msg.tools ?? []).filter(t => t.id !== id), tool]
        this.putMessage(botId, msg)
        this.setStatus(botId, { state: 'working', label: `${toolLabel(name).replace(/^(\S+)ó /, (_, v) => `${v}ando `)}…` })
        break
      }

      case 'tool.complete': {
        const msg = this.current.get(botId)
        const id = String(p.tool_id ?? p.tool_call_id ?? '')
        const tool = msg?.tools?.find(t => t.id === id) ?? msg?.tools?.findLast(t => t.status === 'running')

        if (msg && tool) {
          tool.status = p.error || p.is_error ? 'error' : 'done'
          this.putMessage(botId, msg)
        }

        break
      }

      case 'approval.request':
      case 'clarify.request': {
        const kind = ev.type === 'approval.request' ? 'approval' : 'clarify'
        const id = String(p.prompt_id)

        this.prompts.set(id, { session_id: ev.session_id!, prompt_id: id, execution_generation: Number(p.execution_generation ?? 0), kind })

        const req: PendingRequest = kind === 'approval'
          ? { id, botId, kind, title: 'Hermes pide permiso para continuar', command: p.command ? String(p.command) : undefined, detail: p.description ? `Motivo: ${p.description}` : undefined }
          : { id, botId, kind, title: 'Hermes tiene una duda', question: String(p.question ?? p.questions?.[0]?.question ?? ''), choices: (p.choices ?? p.questions?.[0]?.choices ?? undefined) || undefined }

        this.requests.set(id, req)
        this.broadcast({ t: 'req', req })
        this.setStatus(botId, { state: 'working', label: kind === 'approval' ? 'Esperando vuestro permiso' : 'Esperando vuestra respuesta' })
        break
      }

      case 'approval.settled':
      case 'clarify.settled':
        this.dropRequest(String(p.prompt_id))
        this.setStatus(botId, { state: 'working', label: 'Trabajando…' })
        break

      case 'message.complete': {
        const outcome = String(p.outcome ?? 'completed')
        const failed = !['completed', 'complete', 'interrupted', 'cancelled'].includes(outcome)

        this.finishMessage(botId, String(p.text ?? p.content ?? ''), failed)

        if (failed) {
          this.notice(botId, `Hermes no pudo terminar la respuesta${p.error ? ` (${String(p.error).slice(0, 200)})` : ''}.`, true)
        }

        saved.lastActive[botId] = Date.now()
        persist()
        this.setStatus(botId, { state: 'idle', lastActive: saved.lastActive[botId] })
        void this.refreshRoutines()
        break
      }

      case 'error': {
        this.finishMessage(botId)
        this.notice(botId, `Hermes avisó de un error: ${String(p.message ?? p.error ?? 'desconocido').slice(0, 300)}`, true)
        this.setStatus(botId, { state: 'idle' })
        break
      }

      default:
        break
    }
  }
}
