import type { AppAuth, AppEntry, BackupInfo, Capabilities, ChatMessage, ChatSummary, ModelInfo, ServerEvent, SignIn, Snapshot, TelegramState, WhatsAppState, Widget } from '../../shared/protocol'

export interface ClientState extends Snapshot {
  /** botId → ids de socios escribiendo ahora mismo. */
  typing: Record<string, string[]>
  /** Aviso breve tras guardar algo en Ajustes. */
  toast?: { text: string; error?: boolean; n: number }
  /** Modelos de IA disponibles (solo se pide al abrir Ajustes). */
  model?: ModelInfo
  /** Conversación del historial que se está leyendo. */
  chat?: ChatSummary & { messages: ChatMessage[] }
  backups?: { list: BackupInfo[]; auto: boolean }
  /** Inicio de sesión con una suscripción que está en marcha. */
  login?: SignIn | null
  apps?: AppEntry[]
  telegram?: TelegramState
  whatsapp?: WhatsAppState
  appAuth?: AppAuth | null
  caps?: Capabilities
  widgets?: Widget[]
}

export function initialState(snapshot: Snapshot): ClientState {
  return { ...snapshot, typing: {} }
}

function upsert(list: ChatMessage[], msg: ChatMessage): ChatMessage[] {
  const i = list.findIndex(m => m.id === msg.id)

  if (i === -1) {
    return [...list, msg]
  }

  const next = list.slice()
  next[i] = msg

  return next
}

export function reduce(state: ClientState | null, ev: ServerEvent): ClientState | null {
  if (ev.t === 'hello') {
    return initialState(ev.snapshot)
  }

  if (!state) {
    return state
  }

  switch (ev.t) {
    case 'msg': {
      const list = state.messages[ev.botId] ?? []

      return { ...state, messages: { ...state.messages, [ev.botId]: upsert(list, ev.msg) } }
    }

    case 'msg.gone':
      return { ...state, messages: { ...state.messages, [ev.botId]: (state.messages[ev.botId] ?? []).filter(m => m.id !== ev.id) } }

    case 'delta': {
      const list = state.messages[ev.botId] ?? []

      return {
        ...state,
        messages: {
          ...state.messages,
          [ev.botId]: list.map(m => (m.id === ev.id ? { ...m, text: m.text + ev.text } : m))
        }
      }
    }

    case 'status':
      return { ...state, status: { ...state.status, [ev.botId]: ev.status } }

    case 'typing': {
      const cur = (state.typing[ev.botId] ?? []).filter(id => id !== ev.userId)

      return { ...state, typing: { ...state.typing, [ev.botId]: ev.on ? [...cur, ev.userId] : cur } }
    }

    case 'online':
      return { ...state, online: ev.users }

    case 'req':
      return { ...state, requests: [...state.requests.filter(r => r.id !== ev.req.id), ev.req] }

    case 'req.done':
      return { ...state, requests: state.requests.filter(r => r.id !== ev.id) }

    case 'users':
      return { ...state, users: ev.users, me: ev.users.find(u => u.id === state.me.id) ?? state.me }

    case 'bots':
      return { ...state, bots: ev.bots }

    case 'toast':
      return { ...state, toast: { text: ev.text, error: ev.error, n: Date.now() } }

    case 'model':
      return { ...state, model: ev.info }

    case 'apps':
      return { ...state, apps: ev.apps, telegram: ev.telegram ?? state.telegram, whatsapp: ev.whatsapp ?? state.whatsapp }

    case 'whatsapp':
      return { ...state, whatsapp: ev.state }

    case 'app.auth':
      return { ...state, appAuth: ev.flow }

    case 'caps':
      return { ...state, caps: ev.caps }

    case 'login':
      return { ...state, login: ev.flow }

    case 'msgs':
      return { ...state, messages: { ...state.messages, [ev.botId]: ev.messages } }

    case 'history':
      return { ...state, history: ev.history, chat: state.chat && ev.history.some(c => c.id === state.chat!.id) ? { ...state.chat, title: ev.history.find(c => c.id === state.chat!.id)!.title } : undefined }

    case 'chat':
      return { ...state, chat: ev.chat }

    case 'widgets':
      return { ...state, widgets: ev.widgets }

    case 'backups':
      return { ...state, backups: { list: ev.list, auto: ev.auto } }

    case 'routines':
      return { ...state, routines: ev.routines }

    case 'hermes':
      return { ...state, hermes: ev.state, hermesDetail: ev.detail }
  }

  return state
}
