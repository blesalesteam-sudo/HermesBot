// OpenBot: entrar con usuario y contraseña (POST /api/auth/password) y, solo para administradores, la lista de
// usuarios (GET/POST /api/local-accounts, DELETE /api/local-accounts/<usuario>). Ver ../local-accounts.ts.
import type { IncomingMessage, ServerResponse } from "node:http";

import { json, readBody } from "../harness/http.ts";
import type { PersonNames } from "../host/person-names.ts";
import { localEmail, localUsername, PASSWORD_MIN, type LocalAccount, type LocalAccounts, type LocalRole } from "../local-accounts.ts";
import { accountKey, type OpenbotInvites, type OpenbotPeople } from "../openbot-people.ts";
import type { RequestAuth } from "../request-auth.ts";
import { labelFromUserAgent, requestOrigin, requestSource, serializeSessionCookie } from "../request-auth.ts";
import { cookieMaxAgeSeconds, type SessionRegistry } from "../sessions.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PasswordSignInDeps {
  /** Off where sign-in belongs to someone else (a Cloud home, a hosted workspace). */
  disabled: boolean;
  accounts: LocalAccounts;
  sessions: Pick<SessionRegistry, "attemptAllowed" | "noteFailure" | "clearFailures" | "issue">;
  cookieName: string;
  environment(): unknown;
  /** OpenBot: invitations (GET/POST /api/auth/invite) and the profile a new person starts with. */
  invites?: OpenbotInvites;
  people?: OpenbotPeople;
  names?: PersonNames;
  /** The name this OpenBot goes by, for the invitation page. */
  placeName?(): string;
}

function issueFor(deps: PasswordSignInDeps, req: IncomingMessage, res: ServerResponse, account: LocalAccount, label: string) {
  const issued = deps.sessions.issue({
    label: label.trim() || labelFromUserAgent(req.headers["user-agent"]),
    scopes: account.role === "admin" ? ["admin", "client"] : ["client"],
    userId: `local:${account.username}`,
    email: account.email,
  });
  const secure = requestOrigin(req)?.startsWith("https://") === true;
  res.setHeader("set-cookie", serializeSessionCookie(deps.cookieName, issued.token, { secure, maxAgeSeconds: cookieMaxAgeSeconds(issued.session) }));
  return issued;
}

/** GET /api/auth/invite?token=… says who invites; POST creates the account and signs the person in. Public, like sign-in. */
async function inviteRoute(deps: PasswordSignInDeps, req: IncomingMessage, res: ServerResponse, method: string): Promise<boolean> {
  const invites = deps.invites;
  if (!invites || deps.disabled) {
    json(res, 404, { error: "Este servidor no usa invitaciones." });
    return true;
  }
  const source = requestSource(req);
  const allowed = deps.sessions.attemptAllowed(source);
  if (!allowed.ok) {
    json(res, 429, { error: `Demasiados intentos. Vuelve a probar en ${Math.ceil(allowed.retryAfterMs / 1000)} segundos.`, code: "too_many" });
    return true;
  }
  if (method === "GET") {
    const token = new URL(req.url ?? "/", "http://x").searchParams.get("token") ?? "";
    const invite = token ? invites.peek(token) : null;
    if (!invite) {
      deps.sessions.noteFailure(source);
      json(res, 404, { error: "Esta invitación ya no sirve: se usó o caducó. Pide otra a quien te la mandó.", code: "invite_gone" });
      return true;
    }
    json(res, 200, { byName: invite.byName, expiresAt: invite.expiresAt, place: deps.placeName?.() ?? "OpenBot" });
    return true;
  }
  if (method !== "POST") {
    json(res, 405, { error: "method not allowed" });
    return true;
  }
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
    json(res, 415, { error: "send the invitation as JSON (content-type: application/json)" });
    return true;
  }
  const body = await readBody(req, 8 * 1024);
  const given = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const token = typeof given.token === "string" ? given.token : "";
  if (!token || !invites.peek(token)) {
    deps.sessions.noteFailure(source);
    json(res, 404, { error: "Esta invitación ya no sirve: se usó o caducó. Pide otra a quien te la mandó.", code: "invite_gone" });
    return true;
  }
  const displayName = typeof given.displayName === "string" ? given.displayName.trim() : "";
  if (!displayName) {
    json(res, 400, { error: "Pon tu nombre." });
    return true;
  }
  const made = deps.accounts.save({
    username: typeof given.username === "string" ? given.username : "",
    password: typeof given.password === "string" ? given.password : "",
    displayName, role: "member", createOnly: true,
  });
  if (!made.ok) {
    json(res, 400, { error: made.error });
    return true;
  }
  if (!invites.consume(token, made.account.username)) {
    deps.accounts.remove(made.account.username);
    json(res, 404, { error: "Esta invitación ya no sirve: se usó o caducó.", code: "invite_gone" });
    return true;
  }
  deps.names?.save({ id: "", email: made.account.email }, made.account.displayName);
  deps.people?.save(accountKey(made.account), { name: made.account.displayName });
  deps.sessions.clearFailures(source);
  const issued = issueFor(deps, req, res, made.account, typeof given.label === "string" ? given.label : "");
  console.log(`OpenBot: ${made.account.username} entró con una invitación`);
  json(res, 200, { session: issued.session, environment: deps.environment() });
  return true;
}

export async function passwordSignInRoute(deps: PasswordSignInDeps, req: IncomingMessage, res: ServerResponse, path: string, method: string): Promise<boolean> {
  if (path === "/api/auth/invite") return inviteRoute(deps, req, res, method);
  if (path !== "/api/auth/password") return false;
  if (method !== "POST") {
    json(res, 405, { error: "method not allowed" });
    return true;
  }
  if (deps.disabled) {
    json(res, 404, { error: "Este servidor no usa usuario y contraseña." });
    return true;
  }
  // JSON only: a cross-site HTML form cannot send this content type without a preflight.
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
    json(res, 415, { error: "send the sign-in request as JSON (content-type: application/json)" });
    return true;
  }
  const source = requestSource(req);
  const allowed = deps.sessions.attemptAllowed(source);
  if (!allowed.ok) {
    json(res, 429, { error: `Demasiados intentos. Vuelve a probar en ${Math.ceil(allowed.retryAfterMs / 1000)} segundos.`, code: "too_many" });
    return true;
  }
  const body = await readBody(req, 8 * 1024);
  const given = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const username = typeof given.username === "string" ? given.username : "";
  const password = typeof given.password === "string" ? given.password : "";
  const label = typeof given.label === "string" ? given.label : "";
  const account = username && password ? deps.accounts.verify(username, password) : null;
  if (!account) {
    deps.sessions.noteFailure(source);
    console.warn(`password sign-in refused from ${source}`);
    json(res, 401, { error: "Usuario o contraseña incorrectos.", code: "bad_credentials" });
    return true;
  }
  deps.sessions.clearFailures(source);
  const issued = issueFor(deps, req, res, account, label);
  json(res, 200, { session: issued.session, environment: deps.environment() });
  return true;
}

export interface LocalAccountsRouteDeps {
  accounts: LocalAccounts;
  names: PersonNames;
  people: OpenbotPeople;
  invites: OpenbotInvites;
  /** After a change: sessions of a removed or demoted person end, and open windows refresh. */
  changed(): void;
}

const ROLE = (value: unknown): LocalRole | undefined => (value === "admin" || value === "member" ? value : undefined);

/** Who is asking: an account's person, the owner (on a device they paired with a code, or on this machine), or nobody. */
function meOf(deps: LocalAccountsRouteDeps, auth: RequestAuth): { key: string; account: LocalAccount | null; owner: boolean } | null {
  if (auth.kind === "loopback") {
    const account = deps.accounts.list().find((one) => one.owner) ?? null;
    return { key: deps.people.ownerKey(), account, owner: true };
  }
  const username = localUsername(auth.session.email);
  if (username) {
    const account = deps.accounts.get(username);
    return account ? { key: accountKey(account), account, owner: account.owner === true } : null;
  }
  if (!auth.session.email && auth.scopes.includes("admin")) {
    const account = deps.accounts.list().find((one) => one.owner) ?? null;
    return { key: deps.people.ownerKey(), account, owner: true };
  }
  return null;
}

const TEXT = (value: unknown) => (typeof value === "string" ? value : undefined);

async function openbotRoutes(deps: LocalAccountsRouteDeps, ctx: Parameters<RouteHandler>[0]): Promise<typeof PASS | void> {
  const { req, res, path, method, auth, json: send, readBody: read } = ctx;
  const me = meOf(deps, auth);
  const photo = /^\/api\/openbot\/photo\/([\w-]+)$/.exec(path);
  if (photo && method === "GET") {
    if (!me && auth.kind !== "session") return send(res, 403, { error: "forbidden" });
    const found = deps.people.photo(photo[1]);
    if (!found) return send(res, 404, { error: "Sin foto." });
    res.writeHead(200, { "content-type": found.type, "cache-control": "private, max-age=60" });
    res.end(found.data);
    return;
  }
  if (path === "/api/openbot/people" && method === "GET") {
    return send(res, 200, { people: deps.people.list().map(({ aboutMe: _about, ...person }) => person) });
  }
  if (path === "/api/openbot/me") {
    if (!me) return send(res, 404, { error: "Esta sesión no es de ninguna persona." });
    if (method === "PUT") {
      const body = await read(req, 1024 * 1024);
      const given = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const saved = deps.people.save(me.key, {
        name: TEXT(given.name), job: TEXT(given.job), aboutMe: TEXT(given.aboutMe),
        ...(given.photo === null || typeof given.photo === "string" ? { photo: given.photo as string | null } : {}),
      });
      if (!saved.ok) return send(res, 400, { error: saved.error });
      const name = TEXT(given.name)?.trim();
      if (me.account && name) {
        deps.accounts.save({ username: me.account.username, displayName: name });
        deps.names.save({ id: "", email: me.account.email }, name);
      }
      const password = given.password && typeof given.password === "object" ? given.password as Record<string, unknown> : null;
      if (password && me.account) {
        const current = TEXT(password.current) ?? "", next = TEXT(password.next) ?? "";
        if (!deps.accounts.verify(me.account.username, current)) return send(res, 400, { error: "La contraseña actual no es correcta." });
        const changed = deps.accounts.save({ username: me.account.username, password: next });
        if (!changed.ok) return send(res, 400, { error: changed.error });
      }
      deps.changed();
    } else if (method !== "GET") return send(res, 405, { error: "method not allowed" });
    const account = me.account ? deps.accounts.get(me.account.username) : null;
    const profile = account ? deps.people.byAccount(account) : deps.people.resolve(undefined);
    return send(res, 200, { ...profile, needsAccount: me.owner && !account, passwordMin: PASSWORD_MIN });
  }
  if (path === "/api/openbot/claim" && method === "POST") {
    // The owner, on a device paired with a code, chooses the username and password they will sign in with from now on.
    if (!me?.owner || me.account) return send(res, 400, { error: "Esta cuenta ya tiene usuario y contraseña." });
    const body = await read(req, 8 * 1024);
    const given = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const previous = deps.people.resolve(undefined);
    const name = previous.name;
    const made = deps.accounts.save({ username: TEXT(given.username) ?? "", password: TEXT(given.password) ?? "", displayName: name || TEXT(given.username), owner: true, createOnly: true });
    if (!made.ok) return send(res, 400, { error: made.error });
    // The owner's photo and job move with them to their account.
    const before = deps.people.photo("p_openbot-owner");
    deps.people.save(accountKey(made.account), { job: previous.job, ...(before ? { photo: `data:${before.type};base64,${before.data.toString("base64")}` } : {}) });
    deps.names.save({ id: "", email: made.account.email }, made.account.displayName);
    deps.changed();
    return send(res, 200, { account: made.account });
  }
  if (path === "/api/openbot/invites") {
    if (!auth.scopes.includes("admin")) return send(res, 403, { error: "Solo un administrador invita." });
    if (method === "GET") return send(res, 200, { invites: deps.invites.list() });
    if (method === "POST") {
      const by = me?.account ?? null;
      const name = (me ? deps.people.resolve(me.account ? accountKey(me.account) : undefined).name : "") || by?.displayName || "Tu equipo";
      const made = deps.invites.create({ username: by?.username ?? "dueño", name });
      return send(res, 200, { token: made.token, invite: made.invite });
    }
    return send(res, 405, { error: "method not allowed" });
  }
  const revoke = /^\/api\/openbot\/invites\/([\w-]+)$/.exec(path);
  if (revoke && method === "DELETE") {
    if (!auth.scopes.includes("admin")) return send(res, 403, { error: "Solo un administrador anula invitaciones." });
    return send(res, deps.invites.revoke(revoke[1]) ? 200 : 404, { ok: true });
  }
  return send(res, 404, { error: "not found" });
}

export function createLocalAccountsRoutes(deps: LocalAccountsRouteDeps): RouteHandler {
  return async (ctx) => {
    const { req, res, path, method, json: send, readBody: read } = ctx;
    if (path.startsWith("/api/openbot/") && /^\/api\/openbot\/(me|people|claim|invites|photo\/|invites\/)/.test(path)) return openbotRoutes(deps, ctx);
    if (path !== "/api/local-accounts" && !path.startsWith("/api/local-accounts/")) return PASS;
    if (path === "/api/local-accounts" && method === "GET") return send(res, 200, { accounts: deps.accounts.list().map((account) => ({ ...account, profile: deps.people.byAccount(account) })) });
    if (path === "/api/local-accounts" && method === "POST") {
      const body = await read(req, 8 * 1024);
      const given = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const result = deps.accounts.save({
        username: typeof given.username === "string" ? given.username : "",
        displayName: typeof given.displayName === "string" ? given.displayName : undefined,
        role: ROLE(given.role),
        password: typeof given.password === "string" && given.password ? given.password : undefined,
      });
      if (!result.ok) return send(res, 400, { error: result.error });
      // The name the rest of the app shows for this person (message authors, the speaker note the bots read).
      deps.names.save({ id: "", email: result.account.email }, result.account.displayName);
      deps.changed();
      return send(res, 200, { account: result.account });
    }
    const match = /^\/api\/local-accounts\/([^/]+)$/.exec(path);
    if (match && method === "DELETE") {
      const username = decodeURIComponent(match[1]);
      const result = deps.accounts.remove(username);
      if (!result.ok) return send(res, 400, { error: result.error });
      deps.names.save({ id: "", email: localEmail(username.trim().toLowerCase()) }, null);
      deps.changed();
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: "method not allowed" });
  };
}
