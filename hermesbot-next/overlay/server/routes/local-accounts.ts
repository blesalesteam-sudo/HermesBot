// OpenBot: entrar con usuario y contraseña (POST /api/auth/password) y, solo para administradores, la lista de
// usuarios (GET/POST /api/local-accounts, DELETE /api/local-accounts/<usuario>). Ver ../local-accounts.ts.
import type { IncomingMessage, ServerResponse } from "node:http";

import { json, readBody } from "../harness/http.ts";
import type { PersonNames } from "../host/person-names.ts";
import { localEmail, type LocalAccounts, type LocalRole } from "../local-accounts.ts";
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
}

export async function passwordSignInRoute(deps: PasswordSignInDeps, req: IncomingMessage, res: ServerResponse, path: string, method: string): Promise<boolean> {
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
  const issued = deps.sessions.issue({
    label: label.trim() || labelFromUserAgent(req.headers["user-agent"]),
    scopes: account.role === "admin" ? ["admin", "client"] : ["client"],
    userId: `local:${account.username}`,
    email: account.email,
  });
  const secure = requestOrigin(req)?.startsWith("https://") === true;
  res.setHeader("set-cookie", serializeSessionCookie(deps.cookieName, issued.token, { secure, maxAgeSeconds: cookieMaxAgeSeconds(issued.session) }));
  json(res, 200, { session: issued.session, environment: deps.environment() });
  return true;
}

export interface LocalAccountsRouteDeps {
  accounts: LocalAccounts;
  names: PersonNames;
  /** After a change: sessions of a removed or demoted person end, and open windows refresh. */
  changed(): void;
}

const ROLE = (value: unknown): LocalRole | undefined => (value === "admin" || value === "member" ? value : undefined);

export function createLocalAccountsRoutes(deps: LocalAccountsRouteDeps): RouteHandler {
  return async ({ req, res, path, method, json: send, readBody: read }) => {
    if (path !== "/api/local-accounts" && !path.startsWith("/api/local-accounts/")) return PASS;
    if (path === "/api/local-accounts" && method === "GET") return send(res, 200, { accounts: deps.accounts.list() });
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
