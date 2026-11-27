// OpenBot: avisos «push» (../openbot-webpush.ts). Todo lo pide la propia app, con la sesión de quien la usa:
//   GET    /api/openbot/push?endpoint=…   clave pública del servidor, si este aparato está suscrito y los bots silenciados
//   PUT    /api/openbot/push              { subscription }  activa los avisos en este aparato (o renueva la suscripción)
//   DELETE /api/openbot/push              { endpoint }      los quita de este aparato
//   PUT    /api/openbot/push/bot          { botId, muted }  silencia o vuelve a activar un bot (para esta persona)
//   POST   /api/openbot/push/test         { botId, endpoint } manda un aviso de prueba a este aparato
//   POST   /api/openbot/push/viewing      { threadId }      qué conversación tiene delante (null: ninguna)
import type { IncomingMessage } from "node:http";

import type { OpenbotWebPush } from "../openbot-webpush.ts";
import { validSubscription } from "../openbot-webpush.ts";
import type { RequestAuth } from "../request-auth.ts";
import { labelFromUserAgent, requestOrigin } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface OpenbotPushRouteDeps {
  push: OpenbotWebPush;
  /** La persona (clave de openbot-people) de esta sesión. */
  person(auth: RequestAuth & { kind: "session" }): string;
  /** El bot, si esta sesión lo ve: su nombre y su conversación principal. */
  bot(auth: RequestAuth, botId: string): { name: string; threadId: string } | null;
}

const BASE = "/api/openbot/push";
const ID = /^[\w:.-]{1,200}$/;

function originOf(req: IncomingMessage): string {
  return requestOrigin(req) ?? "";
}

export function createOpenbotPushRoutes(deps: OpenbotPushRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== BASE && !path.startsWith(`${BASE}/`)) return PASS;
    res.setHeader("Cache-Control", "no-store");
    if (auth.kind !== "session") return json(res, 403, { error: "Los avisos son de cada aparato: entra con tu usuario." });
    const key = `session:${auth.session.id}`;
    const person = deps.person(auth);
    const body = async (): Promise<Record<string, unknown>> => {
      if (method === "GET" || method === "HEAD") return {};
      try { return ((await readBody(req, 16_384)) ?? {}) as Record<string, unknown>; } catch { return {}; }
    };

    if (path === BASE) {
      if (method === "GET") {
        const endpoint = new URL(req.url ?? "/", "http://x").searchParams.get("endpoint") ?? undefined;
        return json(res, 200, deps.push.status(key, person, endpoint));
      }
      if (method === "PUT") {
        const sub = validSubscription((await body()).subscription);
        if (!sub) return json(res, 400, { error: "Suscripción no válida" });
        deps.push.subscribe(key, person, sub, originOf(req), labelFromUserAgent(req.headers["user-agent"]));
        return json(res, 200, deps.push.status(key, person, sub.endpoint));
      }
      if (method === "DELETE") {
        const endpoint = (await body()).endpoint;
        deps.push.unsubscribe(key, typeof endpoint === "string" ? endpoint : undefined);
        return json(res, 200, deps.push.status(key, person));
      }
      return json(res, 405, { error: "Method not allowed" });
    }

    if (path === `${BASE}/bot` && method === "PUT") {
      const { botId, muted } = await body();
      if (typeof botId !== "string" || !ID.test(botId) || typeof muted !== "boolean") return json(res, 400, { error: "Datos no válidos" });
      if (!deps.bot(auth, botId)) return json(res, 404, { error: "Ese bot no existe" });
      return json(res, 200, { muted: deps.push.setMuted(person, botId, muted) });
    }

    if (path === `${BASE}/test` && method === "POST") {
      const { botId, endpoint } = await body();
      const bot = typeof botId === "string" && ID.test(botId) ? deps.bot(auth, botId) : null;
      if (!bot) return json(res, 404, { error: "Ese bot no existe" });
      const result = await deps.push.test(key, typeof endpoint === "string" ? endpoint : undefined, { botId: botId as string, botName: bot.name, threadId: bot.threadId });
      return json(res, 200, result);
    }

    if (path === `${BASE}/viewing` && method === "POST") {
      const { threadId } = await body();
      deps.push.viewing(key, typeof threadId === "string" && ID.test(threadId) ? threadId : null);
      res.statusCode = 204;
      res.end();
      return;
    }

    return json(res, 404, { error: "Not found" });
  };
}
