// La "sala" compartida: guarda lo que ven los dos socios, lo reparte en vivo a todos los
// navegadores conectados y habla con Hermes a través del cliente oficial del gateway
// (protocolo hermes-gateway-v1, JSON-RPC por WebSocket).
import { randomUUID } from 'node:crypto'

import type {
  ApprovalChoice, AppEntry, Attachment, Bot, Capabilities, BotStatus, ChatMessage, ChatSummary, ClientCommand, HermesState, ModelInfo, PendingRequest, Routine,
  ServerEvent, SignIn, Snapshot, ToolCall, Upload, User
} from '../shared/protocol.ts'
import { createUser, deleteUser, findUser, publicUser, publicUsers, updateUser } from './auth.ts'
import { listBackups } from './backup.ts'
import { config } from './config.ts'
import { fetchBotFile, findBotFiles } from './files.ts'
import { persist, saved, type ArchivedChat, type StoredUser } from './store.ts'
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

// Proveedores que se conectan iniciando sesión con la suscripción (el puente de hermes-core sabe hacerlo).
const SIGN_IN = new Set(['openai-codex'])
const MAX_ARCHIVED = 300
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
  private retry: NodeJS.Timeout | undefined
  private loginPoll: NodeJS.Timeout | undefined
  private bots: Bot[] = saved.bots ?? config.bots

  private get users(): User[] {
    return publicUsers()
  }

  constructor() {
    this.init()
  }

  private init() {
    this.bots = saved.bots ?? config.bots
    this.status = {}
    this.sessionToBot.clear()
    this.attaching.clear()
    this.current.clear()
    this.lastSegment.clear()
    this.requests.clear()
    this.prompts.clear()

    for (const bot of this.bots) {
      saved.messages[bot.id] ??= []
      this.status[bot.id] = { state: 'idle', lastActive: saved.lastActive[bot.id] }
    }

    for (const [botId, sid] of Object.entries(saved.sessions)) {
      this.sessionToBot.set(sid, botId)
    }
  }

  /** Tras restaurar una copia: se vuelve a leer todo y cada navegador entra de nuevo. */
  reload() {
    this.init()

    for (const v of [...this.viewers]) { v.close() }

    if (this.hermes === 'connected') { void this.onReady() }
  }

  /** Manda la lista de copias guardadas a los administradores conectados (o solo a uno). */
  sendBackups(viewer?: Viewer) {
    const ev: ServerEvent = { t: 'backups', list: listBackups(), auto: saved.autoBackup !== false }

    for (const v of viewer ? [viewer] : this.viewers) {
      if (this.isAdmin(v)) { v.send(ev) }
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
      routines: this.routines,
      history: this.history()
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
      case 'retry':
        return this.redoLast(viewer.user, String(cmd.botId))
      case 'edit':
        return this.redoLast(viewer.user, String(cmd.botId), { id: String(cmd.id), text: String(cmd.text ?? '') })
      case 'hermes.retry':
        if (this.isAdmin(viewer) && this.hermes !== 'connected') {
          this.setHermes('connecting', 'Reconectando con Hermes…')
          this.start()
        }

        return
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
      case 'model.get':
        return this.sendModel(viewer)
      case 'model.key':
        return this.saveModelKey(viewer, String(cmd.slug), String(cmd.key ?? ''))
      case 'model.set':
        return this.setModel(viewer, String(cmd.slug), String(cmd.model))
      case 'model.disconnect':
        return this.disconnectModel(viewer, String(cmd.slug))
      case 'login.start':
        return this.startLogin(viewer, String(cmd.slug))
      case 'login.cancel':
        return this.cancelLogin(viewer)
      case 'bot.model':
        return this.setBotModel(viewer, String(cmd.id), cmd.slug ? String(cmd.slug) : '', cmd.model ? String(cmd.model) : '')
      case 'apps.get':
        return this.sendApps(viewer)
      case 'app.connect':
        return this.connectApp(viewer, String(cmd.id))
      case 'app.finish':
        return this.finishApp(viewer, String(cmd.id), String(cmd.session), String(cmd.pasted ?? ''))
      case 'app.cancel':
        if (this.isAdmin(viewer) && this.gw) {
          await this.gw.request('mcp.servers.oauth.cancel', { name: String(cmd.id), session_id: String(cmd.session) }).catch(() => undefined)
        }

        return viewer.send({ t: 'app.auth', flow: null })
      case 'app.remove':
        return this.removeApp(viewer, String(cmd.id))
      case 'telegram.save':
        return this.saveTelegram(viewer, cmd.token === null ? null : String(cmd.token ?? ''), String(cmd.users ?? ''))
      case 'caps.get':
        return this.sendCaps(viewer)
      case 'cap.toggle':
        return this.toggleCap(viewer, String(cmd.id), !!cmd.on)
      case 'chat.new':
        return this.newChat(viewer, String(cmd.botId))
      case 'chat.open': {
        const chat = saved.archive.find(c => c.id === cmd.id)

        return chat && viewer.send({ t: 'chat', chat: { ...this.summary(chat), messages: chat.messages } })
      }
      case 'chat.restore':
        return this.restoreChat(viewer, String(cmd.id))
      case 'chat.rename': {
        const chat = saved.archive.find(c => c.id === cmd.id)
        const title = String(cmd.title ?? '').trim().slice(0, 80)

        if (chat && title) {
          chat.title = title
          this.historyChanged()
        }

        return
      }
      case 'chat.delete':
        saved.archive = saved.archive.filter(c => c.id !== cmd.id)

        return this.historyChanged()
      case 'backup.list':
        return this.sendBackups(viewer)
      case 'backup.auto':
        if (this.isAdmin(viewer)) {
          saved.autoBackup = !!cmd.on
          persist()
          this.sendBackups()
        }

        return
      default:
        return
    }
  }

  // ───────────── Conversaciones: empezar una nueva e historial ─────────────

  private summary(c: ArchivedChat): ChatSummary {
    return { id: c.id, botId: c.botId, title: c.title, ts: c.ts, count: c.messages.filter(m => m.role !== 'notice').length }
  }

  private history(): ChatSummary[] {
    return saved.archive.map(c => this.summary(c)).sort((a, b) => b.ts - a.ts)
  }

  private historyChanged() {
    persist()
    this.broadcast({ t: 'history', history: this.history() })
  }

  /** Guarda la conversación visible de un bot en el historial y deja el chat en blanco. */
  private shelve(botId: string) {
    const messages = saved.messages[botId] ?? []
    const sid = saved.sessions[botId]

    if (messages.some(m => m.role !== 'notice')) {
      const first = messages.find(m => m.role === 'user' && m.text.trim())?.text.trim().replace(/\s+/g, ' ') ?? ''

      saved.archive.push({
        id: randomUUID(),
        botId,
        title: first ? (first.length > 60 ? `${first.slice(0, 58)}…` : first) : 'Conversación sin título',
        ts: Date.now(),
        sid,
        messages
      })

      if (saved.archive.length > MAX_ARCHIVED) { saved.archive = saved.archive.slice(-MAX_ARCHIVED) }
    }

    if (sid) {
      this.sessionToBot.delete(sid)

      for (const [id, p] of this.prompts) {
        if (p.session_id === sid) { this.dropRequest(id) }
      }
    }

    delete saved.sessions[botId]
    this.attaching.delete(botId)
    this.current.delete(botId)
    this.lastSegment.delete(botId)
    saved.messages[botId] = []
  }

  private busy(viewer: Viewer, botId: string): boolean {
    if (this.status[botId]?.state === 'idle') { return false }

    viewer.send({ t: 'toast', text: 'El bot está trabajando. Espera a que termine o páralo antes.', error: true })

    return true
  }

  private newChat(viewer: Viewer, botId: string) {
    const bot = this.bot(botId)

    if (!bot || this.busy(viewer, botId)) { return }

    if (!(saved.messages[botId] ?? []).some(m => m.role !== 'notice')) {
      return viewer.send({ t: 'toast', text: 'Esta conversación ya está vacía.' })
    }

    this.shelve(botId)
    this.broadcast({ t: 'msgs', botId, messages: [] })
    this.notice(botId, `${viewer.user.name} empezó una conversación nueva. La anterior está en el historial.`)
    this.historyChanged()
  }

  private restoreChat(viewer: Viewer, id: string) {
    const chat = saved.archive.find(c => c.id === id)

    if (!chat || !this.bot(chat.botId) || this.busy(viewer, chat.botId)) { return }

    this.shelve(chat.botId)
    saved.archive = saved.archive.filter(c => c.id !== id)
    saved.messages[chat.botId] = chat.messages

    if (chat.sid) {
      saved.sessions[chat.botId] = chat.sid
      this.sessionToBot.set(chat.sid, chat.botId)
      // Nos volvemos a enganchar a ese hilo de Hermes para que recuerde lo hablado.
      void this.ensureSession(this.bot(chat.botId)!).catch(() => undefined)
    }

    this.broadcast({ t: 'msgs', botId: chat.botId, messages: chat.messages })
    this.notice(chat.botId, `${viewer.user.name} recuperó esta conversación del historial.`)
    this.historyChanged()
  }

  // ───────────── Ajustes: modelo de IA ─────────────

  private async modelInfo(): Promise<ModelInfo> {
    const res = await this.gw!.request<any>('model.options', { include_unconfigured: true })

    return {
      provider: String(res.provider ?? ''),
      model: String(res.model ?? ''),
      providers: (res.providers ?? [])
        .filter((p: any) => p.authenticated || p.auth_type === 'api_key' || SIGN_IN.has(String(p.slug)))
        .map((p: any) => ({
          slug: String(p.slug),
          name: String(p.name || p.slug),
          connected: !!p.authenticated,
          keyBased: p.auth_type === 'api_key',
          signIn: SIGN_IN.has(String(p.slug)) || undefined,
          models: [...new Set<string>([...(p.featured_models ?? []), ...(p.models ?? [])])].slice(0, 200)
        }))
    }
  }

  private async sendModel(viewer: Viewer) {
    if (!this.isAdmin(viewer)) { return }

    if (!this.gw || this.hermes !== 'connected') {
      return viewer.send({ t: 'toast', text: 'Hermes no está conectado ahora mismo.', error: true })
    }

    try {
      viewer.send({ t: 'model', info: await this.modelInfo() })
    } catch (error) {
      viewer.send({ t: 'toast', text: `No pude leer los modelos (${(error as Error).message}).`, error: true })
    }
  }

  private async saveModelKey(viewer: Viewer, slug: string, key: string) {
    if (!this.isAdmin(viewer) || !this.gw) { return }

    if (key.trim().length < 8) {
      return viewer.send({ t: 'toast', text: 'Esa clave parece incompleta.', error: true })
    }

    try {
      // La clave va directa a Hermes, que la guarda en su disco. Esta web no la almacena ni la muestra.
      await this.gw.request('model.save_key', { slug, api_key: key.trim() })
      viewer.send({ t: 'toast', text: 'Clave guardada. Ya puedes elegir un modelo.' })
    } catch (error) {
      viewer.send({ t: 'toast', text: `Hermes no aceptó la clave (${(error as Error).message}).`, error: true })
    }

    await this.sendModel(viewer)
  }

  /** Cambia el modelo de una conversación abierta con la operación oficial de Hermes. */
  private async pickModel(sid: string, slug: string, model: string) {
    const payload: Record<string, unknown> = { model, provider: slug }
    const send = async (extra: Record<string, unknown> = {}) => {
      const snap = await this.gw!.request<any>('session.resume', { session_id: sid })

      return this.gw!.request<any>('session.mutate', {
        session_id: sid,
        request_id: randomUUID(),
        expected_revision: snap.revision,
        expected_generation: snap.execution_generation,
        operation: 'model',
        payload: { ...payload, ...extra }
      })
    }
    const res = await send()

    // Hermes pide una segunda confirmación para modelos caros; quien lo elige es un administrador.
    return res?.status === 'confirmation_required' && res.confirm ? send({ confirm: res.confirm }) : res
  }

  private async setModel(viewer: Viewer, slug: string, model: string) {
    if (!this.isAdmin(viewer) || !this.gw || !model || /\s/.test(model) || /\s/.test(slug)) { return }

    try {
      // 1) Queda como modelo por defecto del equipo (conversaciones nuevas y reinicios).
      const saved_ = await fetch(`${config.hermesAdmin}/admin/model`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.hermesToken}` },
        body: JSON.stringify({ model, provider: slug })
      })

      if (!saved_.ok) {
        const info = await saved_.json().catch(() => ({})) as { error?: string }

        throw new Error(info.error || `respuesta ${saved_.status}`)
      }

      // 2) Y se aplica ya a las conversaciones que están en marcha.
      let failed = ''

      for (const [botId, sid] of Object.entries(saved.sessions)) {
        const bot = this.bot(botId)

        // Los bots con modelo propio se quedan con el suyo.
        if (bot && !bot.model) {
          await this.pickModel(sid, slug, model).catch(error => { failed = (error as Error).message })
        }
      }

      viewer.send(failed
        ? { t: 'toast', text: `Guardado como modelo del equipo, pero una conversación abierta no pudo cambiar todavía (${failed.slice(0, 120)}).`, error: true }
        : { t: 'toast', text: `Ahora el equipo usa ${model}.` })
    } catch (error) {
      viewer.send({ t: 'toast', text: `No pude cambiar el modelo (${(error as Error).message}).`, error: true })
    }

    await this.sendModel(viewer)
  }

  private async disconnectModel(viewer: Viewer, slug: string) {
    if (!this.isAdmin(viewer) || !this.gw || /\s/.test(slug)) { return }

    try {
      await this.gw.request('model.disconnect', { slug })
      viewer.send({ t: 'toast', text: 'Cuenta desconectada.' })
    } catch (error) {
      viewer.send({ t: 'toast', text: `No pude desconectarla (${(error as Error).message}).`, error: true })
    }

    await this.sendModel(viewer)
  }

  // ───────────── Ajustes: iniciar sesión con una suscripción ─────────────

  private async loginCall(method: 'GET' | 'POST' | 'DELETE', slug = ''): Promise<SignIn | null> {
    const res = await fetch(`${config.hermesAdmin}/admin/login${slug ? `?provider=${encodeURIComponent(slug)}` : ''}`, {
      method,
      headers: { authorization: `Bearer ${config.hermesToken}` }
    })
    const data = await res.json().catch(() => ({})) as any

    if (!res.ok) { throw new Error(data.error || `respuesta ${res.status}`) }

    return data.provider ? { slug: data.provider, status: data.status, url: data.url || '', code: data.code || '', error: data.error || undefined } : null
  }

  private toAdmins(ev: ServerEvent) {
    for (const v of this.viewers) {
      if (this.isAdmin(v)) { v.send(ev) }
    }
  }

  private async startLogin(viewer: Viewer, slug: string) {
    if (!this.isAdmin(viewer) || !SIGN_IN.has(slug)) { return }

    try {
      this.toAdmins({ t: 'login', flow: await this.loginCall('POST', slug) })
    } catch (error) {
      return viewer.send({ t: 'toast', text: `No pude empezar el inicio de sesión (${(error as Error).message}).`, error: true })
    }

    clearInterval(this.loginPoll)
    this.loginPoll = setInterval(async () => {
      const flow = await this.loginCall('GET').catch(() => null)

      this.toAdmins({ t: 'login', flow })

      if (flow?.status === 'pending') { return }

      clearInterval(this.loginPoll)

      if (flow?.status === 'done') {
        for (const v of this.viewers) {
          if (this.isAdmin(v)) { void this.sendModel(v) }
        }
      }
    }, 2500)
  }

  private async cancelLogin(viewer: Viewer) {
    if (!this.isAdmin(viewer)) { return }

    clearInterval(this.loginPoll)
    await this.loginCall('DELETE').catch(() => undefined)
    this.toAdmins({ t: 'login', flow: null })
  }

  // ───────────── Ajustes: aplicaciones conectadas ─────────────

  private ready(viewer: Viewer): boolean {
    if (this.gw && this.hermes === 'connected') { return true }

    viewer.send({ t: 'toast', text: 'Hermes no está conectado ahora mismo.', error: true })

    return false
  }

  private async appList(): Promise<AppEntry[]> {
    const gw = this.gw!
    const [catalog, mine, status] = await Promise.all([
      gw.request<any>('mcp.catalog', {}),
      gw.request<any>('mcp.servers.list', {}),
      gw.request<any>('mcp.servers.status', {}).catch(() => ({ servers: [] }))
    ])
    const installed = new Map<string, any>((mine.servers ?? []).map((s: any) => [String(s.name), s]))
    const live = new Map<string, any>((status.servers ?? []).map((s: any) => [String(s.name), s]))
    const state = (name: string): AppEntry['state'] => {
      const s = installed.get(name)

      if (!s) { return 'off' }

      return s.auth === 'oauth' && !s.oauth_tokens_present ? 'auth' : 'on'
    }
    const pretty = (name: string) => name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    const apps: AppEntry[] = (catalog.servers ?? []).map((c: any) => ({
      id: String(c.name),
      name: pretty(String(c.name)),
      about: String(c.description ?? ''),
      state: state(String(c.name)),
      tools: live.get(String(c.name))?.tools || undefined
    }))

    // Las que alguien añadió a mano fuera del catálogo también se enseñan.
    for (const [name] of installed) {
      if (!apps.some(a => a.id === name)) {
        apps.push({ id: name, name: pretty(name), about: 'Herramienta añadida a mano.', state: state(name), tools: live.get(name)?.tools || undefined })
      }
    }

    return apps
  }

  private async sendApps(viewer: Viewer) {
    if (!this.ready(viewer)) { return }

    try {
      const telegram = this.isAdmin(viewer)
        ? await fetch(`${config.hermesAdmin}/admin/telegram`, { headers: { authorization: `Bearer ${config.hermesToken}` } }).then(r => (r.ok ? r.json() : undefined)).catch(() => undefined)
        : undefined

      viewer.send({ t: 'apps', apps: await this.appList(), telegram: telegram ? { connected: !!telegram.connected, users: String(telegram.users ?? '') } : undefined })
    } catch (error) {
      viewer.send({ t: 'toast', text: `No pude leer las aplicaciones (${(error as Error).message}).`, error: true })
    }
  }

  private async connectApp(viewer: Viewer, id: string) {
    if (!this.isAdmin(viewer) || !this.ready(viewer) || !/^[\w-]{1,60}$/.test(id)) { return }

    const gw = this.gw!

    try {
      const mine = await gw.request<any>('mcp.servers.list', {})
      let server = (mine.servers ?? []).find((s: any) => s.name === id)

      if (!server) {
        server = (await gw.request<any>('mcp.servers.add', { name: id, preset: id })).server
      }

      if (server?.auth === 'oauth' && !server.oauth_tokens_present) {
        // Hermes solo acepta que la autorización vuelva a la propia máquina, así que la persona
        // copia la dirección final de su navegador y la pega en la aplicación.
        const flow = await gw.request<any>('mcp.servers.oauth.start', { name: id, client_redirect_uri: 'http://127.0.0.1:8976/callback' })

        viewer.send({ t: 'app.auth', flow: { id, session: String(flow.session_id), url: String(flow.auth_url) } })
      } else {
        const test = await gw.request<any>('mcp.servers.test', { name: id }).catch(() => null)

        viewer.send(test?.ok === false
          ? { t: 'toast', text: `Añadida, pero no responde todavía (${String(test.error ?? '').slice(0, 120)}).`, error: true }
          : { t: 'toast', text: 'Aplicación conectada.' })
      }
    } catch (error) {
      viewer.send({ t: 'toast', text: `No pude conectarla (${(error as Error).message.slice(0, 160)}).`, error: true })
    }

    await this.sendApps(viewer)
  }

  private async finishApp(viewer: Viewer, id: string, session: string, pasted: string) {
    if (!this.isAdmin(viewer) || !this.ready(viewer)) { return }

    const gw = this.gw!
    let query: URLSearchParams

    try {
      query = new URL(pasted.trim()).searchParams
    } catch {
      return viewer.send({ t: 'toast', text: 'Eso no parece una dirección. Copia entera la de la barra del navegador.', error: true })
    }

    if (!query.get('code') && !query.get('error')) {
      return viewer.send({ t: 'toast', text: 'A esa dirección le falta el código. Copia la de la página a la que llegaste tras autorizar.', error: true })
    }

    try {
      await gw.request('mcp.servers.oauth.callback', {
        name: id, session_id: session, code: query.get('code'), state: query.get('state'), error: query.get('error'), iss: query.get('iss')
      })

      for (let i = 0; i < 15; i++) {
        const poll = await gw.request<any>('mcp.servers.oauth.poll', { name: id, session_id: session })

        if (poll.status === 'approved') {
          viewer.send({ t: 'app.auth', flow: null })
          viewer.send({ t: 'toast', text: 'Aplicación conectada.' })

          return void await this.sendApps(viewer)
        }

        if (poll.status === 'error') { throw new Error(String(poll.error_message || 'no se autorizó')) }

        await new Promise(r => setTimeout(r, 1500))
      }

      throw new Error('tarda demasiado en confirmarse')
    } catch (error) {
      viewer.send({ t: 'toast', text: `No se pudo terminar la conexión (${(error as Error).message.slice(0, 160)}).`, error: true })
    }
  }

  private async removeApp(viewer: Viewer, id: string) {
    if (!this.isAdmin(viewer) || !this.ready(viewer)) { return }

    try {
      await this.gw!.request('mcp.servers.remove', { name: id })
      viewer.send({ t: 'toast', text: 'Aplicación desconectada.' })
    } catch (error) {
      viewer.send({ t: 'toast', text: `No pude desconectarla (${(error as Error).message.slice(0, 160)}).`, error: true })
    }

    await this.sendApps(viewer)
  }

  private async saveTelegram(viewer: Viewer, token: string | null, users: string) {
    if (!this.isAdmin(viewer)) { return }

    try {
      const res = await fetch(`${config.hermesAdmin}/admin/telegram`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.hermesToken}` },
        body: JSON.stringify({ token: token === null ? null : token.trim(), users: users.replace(/\s/g, '') })
      })

      if (!res.ok) { throw new Error(res.status === 400 ? 'revisa la clave del bot y los números de usuario' : `respuesta ${res.status}`) }

      viewer.send({ t: 'toast', text: token === null ? 'Telegram desconectado. Hermes se reinicia un momento.' : 'Telegram guardado. Hermes se reinicia un momento para activarlo.' })
      viewer.send({ t: 'apps', apps: await this.appList().catch(() => []), telegram: { connected: token !== null, users: token === null ? '' : users.replace(/\s/g, '') } })
    } catch (error) {
      viewer.send({ t: 'toast', text: `No pude guardar Telegram (${(error as Error).message}).`, error: true })
    }
  }

  // ───────────── Ajustes: capacidades (herramientas y habilidades) ─────────────

  private async sendCaps(viewer: Viewer) {
    if (!this.ready(viewer)) { return }

    try {
      const [sets, skills] = await Promise.all([
        this.gw!.request<any>('toolsets.list', {}),
        this.gw!.request<any>('skills.manage', { action: 'list' }).catch(() => ({ skills: {} }))
      ])
      const caps: Capabilities = {
        // Fuera los paquetes internos de cada canal (hermes-…) y los vacíos: no son una decisión del equipo.
        toolsets: (sets.toolsets ?? [])
          .filter((t: any) => !String(t.name).startsWith('hermes-') && t.tool_count > 0 && !String(t.description ?? '').startsWith('Plugin toolset'))
          .map((t: any) => ({ id: String(t.name), about: String(t.description ?? ''), count: Number(t.tool_count) || 0, on: !!t.enabled })),
        skills: Object.entries(skills.skills ?? {}).map(([group, items]) => ({ group, items: (items as string[]).map(String) }))
      }

      viewer.send({ t: 'caps', caps })
    } catch (error) {
      viewer.send({ t: 'toast', text: `No pude leer las capacidades (${(error as Error).message}).`, error: true })
    }
  }

  private async toggleCap(viewer: Viewer, id: string, on: boolean) {
    if (!this.isAdmin(viewer) || !this.ready(viewer) || !/^[\w-]{1,60}$/.test(id)) { return }

    try {
      await this.gw!.request('tools.configure', { action: on ? 'enable' : 'disable', names: [id] })

      // Las conversaciones abiertas también lo notan desde ya.
      for (const [botId, sid] of Object.entries(saved.sessions)) {
        if (this.bot(botId) && this.status[botId]?.state === 'idle') {
          await this.gw!.request('tools.configure', { action: on ? 'enable' : 'disable', names: [id], session_id: sid }).catch(() => undefined)
        }
      }
    } catch (error) {
      viewer.send({ t: 'toast', text: `No pude cambiarlo (${(error as Error).message.slice(0, 160)}).`, error: true })
    }

    await this.sendCaps(viewer)
  }

  // ───────────── Ajustes: modelo propio de cada bot ─────────────

  private async setBotModel(viewer: Viewer, id: string, slug: string, model: string) {
    const bot = this.bot(id)

    if (!this.isAdmin(viewer) || !bot || /\s/.test(slug) || /\s/.test(model) || (!!slug !== !!model)) { return }

    const next: Bot = { ...bot, model: slug ? { slug, model } : undefined }

    this.bots = this.bots.map(b => (b.id === id ? next : b))
    saved.bots = this.bots
    persist()
    this.broadcast({ t: 'bots', bots: this.bots })

    // Si el bot ya tiene una conversación en marcha, el cambio se aplica en ella ahora mismo.
    const sid = saved.sessions[id]
    let failed = ''

    if (sid && this.gw && this.hermes === 'connected') {
      try {
        const target = next.model ?? await this.modelInfo().then(i => ({ slug: i.provider, model: i.model }))

        if (target.slug && target.model) { await this.pickModel(sid, target.slug, target.model) }
      } catch (error) {
        failed = (error as Error).message
      }
    }

    viewer.send(failed
      ? { t: 'toast', text: `Guardado, pero la conversación abierta no pudo cambiar todavía (${failed.slice(0, 120)}).`, error: true }
      : { t: 'toast', text: next.model ? `${bot.name} usa ahora ${model}.` : `${bot.name} vuelve a usar el modelo del equipo.` })
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
    saved.archive = saved.archive.filter(c => c.botId !== id)
    this.broadcast({ t: 'history', history: this.history() })
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

    if (this.gw) {
      // Reintento: se descarta la conexión anterior, que se quedó sin poder arrancar.
      (this.gw as any).removeAllListeners?.()
      this.gw.kill('reintento')
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

      if (bot.model) {
        await this.pickModel(sid, bot.model.slug, bot.model.model).catch(error => {
          this.notice(bot.id, `No pude poner el modelo propio de este bot (${(error as Error).message.slice(0, 120)}). Usa el del equipo.`, true)
        })
      }

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

  private async sendPrompt(user: User, botId: string, raw: string, rawUploads: Upload[] = [], echo = true) {
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
    if (echo) {
      this.putMessage(botId, { id: randomUUID(), role: 'user', authorId: user.id, text, attachments: attachments.length ? attachments : undefined, ts: Date.now() })
    } else {
      this.notice(botId, `${user.name} pidió otra respuesta.`)
    }

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

  /** Borra de la memoria de Hermes el último mensaje de una persona y todo lo que vino después. */
  private async rewindLast(botId: string) {
    const sid = saved.sessions[botId]

    if (!sid || !this.gw || this.hermes !== 'connected') { return false }

    const snap = await this.gw.request<any>('session.resume', { session_id: sid })
    const target = [...(snap?.messages ?? [])].reverse().find((m: any) => m.role === 'user' && !m.archived && Number.isInteger(m.row_id))

    if (!target) { return false }

    const res = await this.gw.request<any>('session.mutate', {
      session_id: sid,
      request_id: randomUUID(),
      expected_revision: snap.revision,
      expected_generation: snap.execution_generation,
      operation: 'rewind',
      payload: { target_message_id: target.row_id }
    })

    return Number(res?.rewound_count) > 0
  }

  /**
   * Rehace el último turno: con `edit` se corrige el último mensaje propio; sin él se pide otra respuesta.
   * En los dos casos Hermes olvida la versión anterior, para que no le quede repetida en la conversación.
   */
  private async redoLast(user: User, botId: string, edit?: { id: string; text: string }) {
    const list = saved.messages[botId] ?? []
    const at = list.findLastIndex(m => m.role === 'user')
    const last = list[at]

    if (!last || this.status[botId]?.state !== 'idle') { return }

    const text = edit ? edit.text.trim() : last.text

    if (edit && (last.id !== edit.id || last.authorId !== user.id || last.attachments?.length || !text || text === last.text)) { return }
    if (!text.trim()) { return }

    let rewound = false

    // Con adjuntos no se rebobina: al repetir solo viajaría el texto y Hermes perdería los archivos.
    if (!last.attachments?.length) {
      rewound = await this.rewindLast(botId).catch(error => {
        console.warn('[hermes] no pude rebobinar', botId, (error as Error).message)

        return false
      })
    }

    if (edit && !rewound) {
      return this.notice(botId, 'No se pudo corregir el mensaje. Escríbelo de nuevo como mensaje normal.', true)
    }

    if (rewound) {
      saved.messages[botId] = list.slice(0, edit ? at : at + 1)
      persist()
      this.broadcast({ t: 'msgs', botId, messages: saved.messages[botId]! })
    }

    return this.sendPrompt(user, botId, text, [], !!edit)
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
        const whole: ChatMessage = { id: randomUUID(), role: 'assistant', text: finalText, ts: Date.now(), error }

        this.putMessage(botId, whole)
        void this.collectFiles(botId, whole)
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
    void this.collectFiles(botId, msg)
  }

  /** Si la respuesta menciona archivos creados por el bot, se traen y se enseñan como adjuntos. */
  private async collectFiles(botId: string, msg: ChatMessage) {
    const { paths, clean } = findBotFiles(msg.text)

    if (!paths.length) { return }

    const found = (await Promise.all(paths.map(fetchBotFile))).filter((a): a is Attachment => a !== null)

    // Mientras tanto pudieron empezar otra conversación: solo se toca si el mensaje sigue ahí.
    if (!found.length || !(saved.messages[botId] ?? []).includes(msg)) { return }

    msg.attachments = [...(msg.attachments ?? []), ...found]
    msg.text = clean || (found.length === 1 ? 'Aquí lo tienes.' : 'Aquí los tienes.')
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
        // Si Hermes tarda en arrancar (por ejemplo, tras restaurar una copia), se sigue intentando.
        clearTimeout(this.retry)
        this.retry = setTimeout(() => { if (this.hermes === 'offline') { this.start() } }, 15_000)

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
