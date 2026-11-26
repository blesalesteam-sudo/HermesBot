// Lo que viaja entre el navegador y el servidor de hermesBot.
// El servidor guarda el estado compartido (bots, mensajes, peticiones de permiso)
// y se lo manda a los dos socios a la vez, así ambos ven lo mismo en vivo.

export interface User {
  id: string
  name: string
  /** Foto (URL). Si no hay, se pintan las iniciales sobre `color`. */
  avatar?: string
  color: string
  /** Nombre con el que entra (para Ajustes). */
  username?: string
  /** Puede crear y editar usuarios y bots. */
  admin?: boolean
}

export interface Bot {
  id: string
  name: string
  role: string
  color: string
  /** Instrucciones de personalidad que se le dan a Hermes la primera vez. */
  persona?: string
}

export interface ToolCall {
  id: string
  name: string
  /** Frase corta en lenguaje normal: "Buscó en la web", "Leyó un archivo". */
  label: string
  status: 'running' | 'done' | 'error'
  detail?: string
}

/** Archivo o imagen adjunta a un mensaje. De las imágenes se guarda una miniatura. */
export interface Attachment {
  id: string
  name: string
  kind: 'image' | 'file'
  size: number
  preview?: string
}

/** Archivo que sube el navegador junto a un mensaje (contenido como data URL). */
export interface Upload {
  name: string
  type: string
  size: number
  data: string
  preview?: string
}

/** Tarea programada de Hermes ("todos los lunes a las 9…"). */
export interface Routine {
  id: string
  name: string
  /** Cuándo se ejecuta, en palabras normales. */
  when: string
  what: string
  enabled: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'notice'
  /** Socio que lo escribió (solo en mensajes de usuario). */
  authorId?: string
  text: string
  tools?: ToolCall[]
  attachments?: Attachment[]
  streaming?: boolean
  error?: boolean
  ts: number
}

export type BotState = 'idle' | 'thinking' | 'working'

export interface BotStatus {
  state: BotState
  /** Qué está haciendo, en palabras sencillas. */
  label?: string
  lastActive?: number
}

export interface PendingRequest {
  id: string
  botId: string
  kind: 'approval' | 'clarify' | 'secret'
  title: string
  detail?: string
  command?: string
  question?: string
  choices?: string[]
  /** Cuando un socio ya respondió, para que el otro lo vea. */
  answeredBy?: string
}

export type HermesState = 'connected' | 'connecting' | 'offline' | 'demo'

export interface Snapshot {
  me: User
  users: User[]
  bots: Bot[]
  messages: Record<string, ChatMessage[]>
  status: Record<string, BotStatus>
  requests: PendingRequest[]
  online: string[]
  hermes: HermesState
  hermesDetail?: string
  routines?: Routine[]
}

export type ServerEvent =
  | { t: 'hello'; snapshot: Snapshot }
  | { t: 'msg'; botId: string; msg: ChatMessage }
  | { t: 'msg.gone'; botId: string; id: string }
  | { t: 'delta'; botId: string; id: string; text: string }
  | { t: 'status'; botId: string; status: BotStatus }
  | { t: 'typing'; botId: string; userId: string; on: boolean }
  | { t: 'online'; users: string[] }
  | { t: 'req'; req: PendingRequest }
  | { t: 'req.done'; id: string }
  | { t: 'hermes'; state: HermesState; detail?: string }
  | { t: 'routines'; routines: Routine[] }
  | { t: 'users'; users: User[] }
  | { t: 'bots'; bots: Bot[] }
  | { t: 'toast'; text: string; error?: boolean }

export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'

export type ClientCommand =
  | { t: 'send'; botId: string; text: string; uploads?: Upload[] }
  | { t: 'routine'; id: string; action: 'pause' | 'resume' | 'remove' }
  | { t: 'typing'; botId: string; on: boolean }
  | { t: 'approve'; reqId: string; choice: ApprovalChoice }
  | { t: 'clarify'; reqId: string; answer: string | null }
  | { t: 'secret'; reqId: string; value: string | null }
  | { t: 'stop'; botId: string }
  // Ajustes. Sin `id` se crea; con `id` se edita. Solo un administrador toca a otros usuarios y a los bots.
  | { t: 'user.save'; id?: string; username?: string; name?: string; avatar?: string | null; password?: string; admin?: boolean }
  | { t: 'user.delete'; id: string }
  | { t: 'bot.save'; id?: string; name: string; role: string; color: string; persona?: string }
  | { t: 'bot.delete'; id: string }
