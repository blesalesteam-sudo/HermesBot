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
  /** Cuenta y modelo propios de este bot. Sin esto usa el modelo del equipo. */
  model?: { slug: string; model: string }
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
  /** Dirección para abrirlo o descargarlo (archivos que crea el bot). */
  url?: string
}

/** Una conversación anterior guardada en el historial de un bot. */
export interface ChatSummary {
  id: string
  botId: string
  title: string
  /** Cuándo se archivó. */
  ts: number
  count: number
}

/** Una copia de seguridad guardada en el servidor. */
export interface BackupInfo {
  name: string
  ts: number
  size: number
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

/** Un proveedor de IA que Hermes sabe usar (OpenRouter, Anthropic, Google…). */
export interface ModelProvider {
  slug: string
  name: string
  /** Ya tiene una clave válida guardada. */
  connected: boolean
  /** Se conecta pegando una clave (los demás necesitan pasos fuera de la app). */
  keyBased: boolean
  /** Se conecta iniciando sesión con la suscripción (página + código), sin claves. */
  signIn?: boolean
  models: string[]
}

/** Inicio de sesión con una suscripción que está en marcha. */
export interface SignIn {
  slug: string
  status: 'pending' | 'done' | 'error'
  /** Página que hay que abrir y código que hay que escribir en ella. */
  url: string
  code: string
  error?: string
}

export interface ModelInfo {
  provider: string
  model: string
  providers: ModelProvider[]
}

/** Una aplicación externa que Hermes sabe usar (Notion, Stripe, Linear…). */
export interface AppEntry {
  id: string
  name: string
  about: string
  /** off: sin añadir · auth: añadida pero falta autorizarla · on: lista para usar. */
  state: 'off' | 'auth' | 'on'
  /** Cuántas acciones le da al bot (cuando se sabe). */
  tools?: number
}

/** Autorización de una aplicación que está a medias. */
export interface AppAuth {
  id: string
  session: string
  url: string
}

export interface Capabilities {
  /** Grupos de herramientas del bot que se pueden encender o apagar. */
  toolsets: { id: string; about: string; count: number; on: boolean }[]
  /** Habilidades instaladas, por categoría. */
  skills: { group: string; items: string[] }[]
}

export interface TelegramState {
  connected: boolean
  users: string
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
  history?: ChatSummary[]
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
  | { t: 'model'; info: ModelInfo }
  | { t: 'login'; flow: SignIn | null }
  | { t: 'apps'; apps: AppEntry[]; telegram?: TelegramState }
  | { t: 'app.auth'; flow: AppAuth | null }
  | { t: 'caps'; caps: Capabilities }
  /** Sustituye la conversación visible de un bot (al empezar una nueva o recuperar otra). */
  | { t: 'msgs'; botId: string; messages: ChatMessage[] }
  | { t: 'history'; history: ChatSummary[] }
  /** Una conversación del historial, para leerla. */
  | { t: 'chat'; chat: ChatSummary & { messages: ChatMessage[] } }
  | { t: 'backups'; list: BackupInfo[]; auto: boolean }

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
  | { t: 'model.get' }
  | { t: 'model.key'; slug: string; key: string }
  | { t: 'model.set'; slug: string; model: string }
  | { t: 'model.disconnect'; slug: string }
  | { t: 'login.start'; slug: string }
  | { t: 'login.cancel' }
  /** Sin `slug` el bot vuelve a usar el modelo del equipo. */
  | { t: 'bot.model'; id: string; slug?: string; model?: string }
  | { t: 'chat.new'; botId: string }
  | { t: 'chat.open'; id: string }
  | { t: 'chat.restore'; id: string }
  | { t: 'chat.rename'; id: string; title: string }
  | { t: 'chat.delete'; id: string }
  | { t: 'apps.get' }
  | { t: 'app.connect'; id: string }
  /** `pasted` es la dirección a la que el navegador fue tras autorizar. */
  | { t: 'app.finish'; id: string; session: string; pasted: string }
  | { t: 'app.cancel'; id: string; session: string }
  | { t: 'app.remove'; id: string }
  /** `token: null` desconecta Telegram. */
  | { t: 'telegram.save'; token: string | null; users?: string }
  | { t: 'caps.get' }
  | { t: 'cap.toggle'; id: string; on: boolean }
  | { t: 'backup.list' }
  | { t: 'backup.auto'; on: boolean }
