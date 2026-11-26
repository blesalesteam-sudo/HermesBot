// Cuentas de la aplicación: se crean y editan desde Ajustes y se guardan en el disco de la
// web (nunca la contraseña, solo su huella). El acceso usa una cookie firmada.
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

import { USER_COLORS } from '../shared/defaults.ts'
import type { User } from '../shared/protocol.ts'
import { config } from './config.ts'
import { persist, saved, type StoredUser } from './store.ts'

const COOKIE = 'hb_session'
const MAX_AGE_S = 60 * 60 * 24 * 30

const sign = (value: string) => createHmac('sha256', config.sessionSecret).update(value).digest('base64url')
const hash = (password: string, salt: string) => scryptSync(password, salt, 32).toString('hex')

export const publicUser = (u: StoredUser): User => ({ id: u.id, name: u.name, avatar: u.avatar, color: u.color, username: u.username, admin: u.admin })
export const publicUsers = (): User[] => saved.users.map(publicUser)
export const findUser = (id: string) => saved.users.find(u => u.id === id) ?? null
export const hasUsers = () => saved.users.length > 0

export interface UserInput {
  username?: string
  name?: string
  avatar?: string | null
  password?: string
  admin?: boolean
}

/** Comprueba los datos de una cuenta. Devuelve el motivo si algo no vale. */
function problem(input: UserInput, existing: StoredUser | null): string | null {
  const username = input.username?.trim().toLowerCase()

  if (username !== undefined) {
    if (!/^[a-z0-9._-]{2,32}$/.test(username)) { return 'El usuario debe tener entre 2 y 32 letras o números, sin espacios.' }
    if (saved.users.some(u => u.username === username && u.id !== existing?.id)) { return 'Ya existe una cuenta con ese usuario.' }
  } else if (!existing) {
    return 'Falta el usuario.'
  }

  if (input.name !== undefined && (input.name.trim().length < 1 || input.name.trim().length > 40)) { return 'El nombre debe tener entre 1 y 40 letras.' }
  if (!existing && !input.name?.trim()) { return 'Falta el nombre.' }
  if (input.password !== undefined && input.password.length < 6) { return 'La contraseña debe tener al menos 6 caracteres.' }
  if (!existing && !input.password) { return 'Falta la contraseña.' }
  if (input.avatar && (!input.avatar.startsWith('data:image/') || input.avatar.length > 150_000)) { return 'La foto no es válida o pesa demasiado.' }

  return null
}

export function createUser(input: UserInput): { user?: StoredUser; error?: string } {
  const error = problem(input, null)

  if (error) { return { error } }

  const salt = randomBytes(16).toString('hex')
  const user: StoredUser = {
    id: randomUUID(),
    username: input.username!.trim().toLowerCase(),
    name: input.name!.trim(),
    avatar: input.avatar || undefined,
    color: USER_COLORS[saved.users.length % USER_COLORS.length]!,
    admin: !!input.admin || saved.users.length === 0,
    salt,
    hash: hash(input.password!, salt),
    ver: 1
  }

  saved.users.push(user)
  persist()

  return { user }
}

export function updateUser(id: string, input: UserInput): { user?: StoredUser; error?: string } {
  const user = findUser(id)

  if (!user) { return { error: 'Esa cuenta ya no existe.' } }

  const error = problem(input, user)

  if (error) { return { error } }

  if (input.admin === false && user.admin && saved.users.filter(u => u.admin).length === 1) {
    return { error: 'Tiene que quedar al menos un administrador.' }
  }

  if (input.username !== undefined) { user.username = input.username.trim().toLowerCase() }
  if (input.name !== undefined) { user.name = input.name.trim() }
  if (input.avatar !== undefined) { user.avatar = input.avatar || undefined }
  if (input.admin !== undefined) { user.admin = input.admin }

  if (input.password) {
    user.salt = randomBytes(16).toString('hex')
    user.hash = hash(input.password, user.salt)
    // Cambiar la contraseña cierra las sesiones abiertas en otros dispositivos.
    user.ver += 1
  }

  persist()

  return { user }
}

export function deleteUser(id: string): string | null {
  const user = findUser(id)

  if (!user) { return 'Esa cuenta ya no existe.' }
  if (user.admin && saved.users.filter(u => u.admin).length === 1) { return 'Tiene que quedar al menos un administrador.' }

  saved.users.splice(saved.users.indexOf(user), 1)
  persist()

  return null
}

// Compatibilidad: si no hay cuentas y Railway trae SOCIO1_*/SOCIO2_*, se crean a partir de ahí.
if (!hasUsers()) {
  for (const acc of config.accounts) {
    createUser({ username: acc.username, name: acc.name, password: acc.password, avatar: acc.avatar?.startsWith('data:image/') ? acc.avatar : undefined })
  }
}

export function checkLogin(username: string, password: string): StoredUser | null {
  const wanted = username.trim().toLowerCase()
  let found: StoredUser | null = null

  // Se comprueban todas las cuentas para tardar lo mismo exista o no el usuario.
  for (const user of saved.users) {
    const ok = timingSafeEqual(Buffer.from(hash(password, user.salt)), Buffer.from(user.hash)) && user.username === wanted

    if (ok) { found = user }
  }

  return found
}

export function sessionCookie(user: StoredUser): string {
  const body = `${user.id}.${Math.floor(Date.now() / 1000) + MAX_AGE_S}.${user.ver}`
  const secure = config.production ? '; Secure' : ''

  return `${COOKIE}=${body}.${sign(body)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`

export function accountFromRequest(req: IncomingMessage): StoredUser | null {
  const raw = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith(`${COOKIE}=`))

  if (!raw) { return null }

  const [id, exp, ver, mac] = raw.slice(COOKIE.length + 1).split('.')

  if (!id || !exp || !ver || !mac) { return null }

  const expected = sign(`${id}.${exp}.${ver}`)

  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) { return null }
  if (Number(exp) < Date.now() / 1000) { return null }

  const user = findUser(id)

  return user && String(user.ver) === ver ? user : null
}

// Freno sencillo contra intentos de adivinar la contraseña: 8 intentos por minuto y por IP.
const attempts = new Map<string, number[]>()

export function tooManyAttempts(ip: string): boolean {
  const now = Date.now()
  const recent = (attempts.get(ip) ?? []).filter(t => now - t < 60_000)

  recent.push(now)
  attempts.set(ip, recent)

  return recent.length > 8
}
