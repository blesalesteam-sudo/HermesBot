// OpenBot: cuentas de usuario y contraseña en el propio servidor, para que varias personas (por ejemplo dos socios)
// entren cada una con lo suyo, trabajen con los mismos bots y cada mensaje lleve quién lo escribió.
//
// Cada cuenta tiene una dirección interna `<usuario>@openbot.local`: el resto de la app ya identifica a las personas por su
// correo (sesiones, nombre que se muestra, visibilidad de cada bot, notas de quién habla), así que esa dirección hace
// que todo eso funcione igual que con el acceso por correo. Nunca se envía ningún correo a esas direcciones.
//
// Las contraseñas se guardan con scrypt y sal propia; nunca en claro.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";

export type LocalRole = "admin" | "member";

interface StoredAccount {
  username: string;
  displayName: string;
  role: LocalRole;
  salt: string;
  hash: string;
  createdAt: number;
  /** OpenBot: the owner of this OpenBot (their profile is the server's own, config.json → profile). */
  owner?: boolean;
}

export interface LocalAccount {
  username: string;
  displayName: string;
  role: LocalRole;
  email: string;
  createdAt: number;
  owner?: boolean;
}

export const LOCAL_EMAIL_DOMAIN = "openbot.local";
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,31}$/;
export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;
const DISPLAY_NAME_MAX = 60;
const KEY_LENGTH = 64;

export function localEmail(username: string): string {
  return `${username}@${LOCAL_EMAIL_DOMAIN}`;
}

/** The username of a `<usuario>@openbot.local` address, else null. */
export function localUsername(email: string | undefined): string | null {
  const match = /^([^@]+)@openbot\.local$/i.exec(email?.trim() ?? "");
  return match ? match[1].toLowerCase() : null;
}

function digest(password: string, salt: string): string {
  return scryptSync(password, salt, KEY_LENGTH).toString("base64");
}

export type AccountInput = { username: string; displayName?: string; role?: LocalRole; password?: string; owner?: boolean; createOnly?: boolean };
export type AccountResult = { ok: true; account: LocalAccount } | { ok: false; error: string };

export interface LocalAccounts {
  list(): LocalAccount[];
  count(): number;
  get(username: string): LocalAccount | null;
  /** The scopes a `<usuario>@openbot.local` session keeps, or null when the address is not a local account. */
  scopes(email: string): ("admin" | "client")[] | null;
  verify(username: string, password: string): LocalAccount | null;
  /** Creates the account (password required) or changes it (password optional). */
  save(input: AccountInput): AccountResult;
  remove(username: string): { ok: true } | { ok: false; error: string };
}

export function createLocalAccounts(dataDir: string): LocalAccounts {
  const file = join(dataDir, "local-accounts.json");
  let cache: StoredAccount[] | null = null;

  const read = (): StoredAccount[] => {
    if (cache) return cache;
    try {
      const raw = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
      cache = Array.isArray(raw) ? raw.filter((entry) => entry && typeof entry.username === "string" && typeof entry.hash === "string") : [];
    } catch {
      cache = [];
    }
    return cache;
  };
  const write = (accounts: StoredAccount[]) => {
    writeFileAtomic(file, JSON.stringify(accounts, null, 2), { mode: 0o600 });
    cache = accounts;
  };
  const shown = (stored: StoredAccount): LocalAccount => ({
    username: stored.username, displayName: stored.displayName, role: stored.role, email: localEmail(stored.username), createdAt: stored.createdAt,
    ...(stored.owner ? { owner: true } : {}),
  });
  const find = (username: string) => read().find((account) => account.username === username.trim().toLowerCase());

  return {
    list: () => read().map(shown),
    count: () => read().length,
    get: (username) => {
      const found = find(username);
      return found ? shown(found) : null;
    },
    scopes(email) {
      const username = localUsername(email);
      const found = username ? find(username) : undefined;
      if (!found) return null;
      return found.role === "admin" ? ["admin", "client"] : ["client"];
    },
    verify(username, password) {
      const found = find(username);
      // The same work whether or not the account exists, so the answer time does not tell which usernames exist.
      const salt = found?.salt ?? "openbot-no-such-account";
      const expected = Buffer.from(found?.hash ?? digest("x", salt), "base64");
      const given = Buffer.from(digest(String(password).slice(0, PASSWORD_MAX), salt), "base64");
      const same = expected.length === given.length && timingSafeEqual(expected, given);
      return found && same ? shown(found) : null;
    },
    save(input) {
      const username = String(input.username ?? "").trim().toLowerCase();
      if (!USERNAME_PATTERN.test(username)) {
        return { ok: false, error: "El usuario tiene de 2 a 32 caracteres: letras minúsculas, números, punto, guion o guion bajo, y empieza por letra o número." };
      }
      const displayName = (input.displayName ?? "").trim().slice(0, DISPLAY_NAME_MAX);
      if (input.role !== undefined && input.role !== "admin" && input.role !== "member") return { ok: false, error: "El rol es admin o member." };
      if (input.password !== undefined && (input.password.length < PASSWORD_MIN || input.password.length > PASSWORD_MAX)) {
        return { ok: false, error: `La contraseña tiene al menos ${PASSWORD_MIN} caracteres.` };
      }
      const accounts = [...read()];
      const index = accounts.findIndex((account) => account.username === username);
      if (index < 0) {
        if (!input.password) return { ok: false, error: "Pon una contraseña para la cuenta nueva." };
        if (input.owner && accounts.some((account) => account.owner)) return { ok: false, error: "Este OpenBot ya tiene dueño." };
        const salt = randomBytes(16).toString("base64");
        const stored: StoredAccount = { username, displayName: displayName || username, role: input.owner ? "admin" : input.role ?? "member", salt, hash: digest(input.password, salt), createdAt: Date.now(), ...(input.owner ? { owner: true } : {}) };
        accounts.push(stored);
        write(accounts);
        return { ok: true, account: shown(stored) };
      }
      if (input.createOnly) return { ok: false, error: "Ese usuario ya existe. Elige otro." };
      const current = accounts[index];
      if (current.owner && input.role === "member") return { ok: false, error: "El dueño siempre es administrador." };
      const nextRole = input.role ?? current.role;
      if (current.role === "admin" && nextRole !== "admin" && accounts.filter((account) => account.role === "admin").length === 1) {
        return { ok: false, error: "Tiene que quedar al menos un administrador." };
      }
      const next: StoredAccount = { ...current, role: nextRole, displayName: displayName || current.displayName };
      if (input.password) {
        next.salt = randomBytes(16).toString("base64");
        next.hash = digest(input.password, next.salt);
      }
      accounts[index] = next;
      write(accounts);
      return { ok: true, account: shown(next) };
    },
    remove(username) {
      const accounts = read();
      const found = find(username);
      if (!found) return { ok: false, error: "No existe ese usuario." };
      if (found.owner) return { ok: false, error: "La cuenta del dueño no se puede borrar." };
      if (found.role === "admin" && accounts.filter((account) => account.role === "admin").length === 1) {
        return { ok: false, error: "No se puede borrar el último administrador." };
      }
      write(accounts.filter((account) => account !== found));
      return { ok: true };
    },
  };
}

/** First start on Railway: OPENBOT_ADMIN_USER and OPENBOT_ADMIN_PASSWORD create the first admin when there is none yet. */
export function seedFirstAdmin(accounts: LocalAccounts, env: NodeJS.ProcessEnv = process.env): string | null {
  const username = env.OPENBOT_ADMIN_USER?.trim();
  const password = env.OPENBOT_ADMIN_PASSWORD;
  if (!username || !password || accounts.count() > 0) return null;
  const made = accounts.save({ username, password, role: "admin", owner: true, displayName: env.OPENBOT_ADMIN_NAME?.trim() || username });
  if (!made.ok) {
    console.warn(`OpenBot: no se pudo crear el primer administrador: ${made.error}`);
    return null;
  }
  return made.account.username;
}
