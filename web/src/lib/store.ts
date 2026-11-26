import type { ChatMessage, ServerEvent, Snapshot } from '../../shared/protocol'

export interface ClientState extends Snapshot {
  /** botId → ids de socios escribiendo ahora mismo. */
  typing: Record<string, string[]>
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

    case 'routines':
      return { ...state, routines: ev.routines }

    case 'hermes':
      return { ...state, hermes: ev.state, hermesDetail: ev.detail }
  }

  return state
}
