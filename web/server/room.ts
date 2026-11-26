// La "sala" compartida: guarda lo que ven los dos socios, lo reparte en vivo a todos los
// navegadores conectados y habla con Hermes a través del cliente oficial del gateway
// (protocolo hermes-gateway-v1, JSON-RPC por WebSocket).
import { randomUUID } from 'node:crypto'

import type {
  ApprovalChoice, Bot, BotStatus, ChatMessage, ClientCommand, HermesState, PendingRequest, ServerEvent, Snapshot,
  ToolCall, User
} from '../shared/protocol.ts'
import { type Account, config } from './config.ts'
import { persist, saved } from './store.ts'
import { GatewayClient } from './vendor/hermes-shared/node/gateway-client.ts'

type Send = (ev: ServerEvent) => void

interface Viewer {
  user: User
  send: Send
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

const publicUser = (a: Account): User => ({ id: a.id, name: a.name, avatar: a.avatar, color: a.color })

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
  private readonly users: User[] = config.accounts.map(publicUser)
  private readonly bots: Bot[] = config.bots

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

  join(account: Account, send: Send): Viewer {
    const viewer: Viewer = { user: publicUser(account), send }

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
      bots: this.bots.map(({ persona: _persona, ...bot }) => bot),
      messages: saved.messages,
      status: this.status,
      requests: [...this.requests.values()],
      online: this.online(),
      hermes: this.hermes,
      hermesDetail: this.hermesDetail
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
        return this.sendPrompt(viewer.user, cmd.botId, String(cmd.text ?? ''))
      case 'stop':
        return this.stop(cmd.botId)
      case 'approve':
        return this.answer(cmd.reqId, viewer.user, { choice: cmd.choice })
      case 'clarify':
        return this.answer(cmd.reqId, viewer.user, { answer: cmd.answer ?? '' })
      default:
        return
    }
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

  private async sendPrompt(user: User, botId: string, raw: string) {
    const bot = this.bot(botId)
    const text = raw.trim().slice(0, 20_000)

    if (!bot || !text) { return }

    this.setTyping(botId, user.id, false)
    this.putMessage(botId, { id: randomUUID(), role: 'user', authorId: user.id, text, ts: Date.now() })

    if (this.hermes !== 'connected' || !this.gw) {
      this.notice(botId, 'Hermes no está conectado ahora mismo. Vuelve a intentarlo en unos segundos.', true)

      return
    }

    const firstTurn = !saved.sessions[botId]

    try {
      this.setStatus(botId, { state: 'thinking', label: 'Pensando…' })

      const sid = await this.ensureSession(bot)
      // Hermes recibe siempre quién habla (texto para el modelo), pero el mensaje guardado queda limpio.
      const persona = firstTurn && bot.persona
        ? `[Contexto del equipo: ${bot.persona} En este chat te escriben dos socios, ${this.users.map(u => u.name).join(' y ')}; cada mensaje indica quién lo escribe.]\n\n`
        : ''

      await this.gw.request('prompt.submit', {
        session_id: sid,
        text,
        api_text: `${persona}[Mensaje de ${user.name}]\n${text}`,
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
