// OpenBot: Ajustes > Funciones > Grupos de Telegram y WhatsApp (server/grupos). Ámbito admin, el que request-auth
// da por defecto a una ruta nueva: un miembro sin permisos o la consola de un bot no llegan aquí.
//   GET    /api/grupos                       estado (el token nunca sale, solo si está puesto)
//   PATCH  /api/grupos                       activar, modos por grupo, bots que leen, bot que responde
//   PUT    /api/grupos/telegram/token        { token }      DELETE: quitarlo
//   POST   /api/grupos/whatsapp/vincular     muestra un código QR para escanear
//   POST   /api/grupos/whatsapp/desvincular  cierra la sesión y borra sus archivos
import type { Grupos } from "../grupos/index.ts";
import { PASS, type RouteHandler } from "./table.ts";

const BASE = "/api/grupos";

export function createGruposRoutes(grupos: Grupos): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (path !== BASE && !path.startsWith(`${BASE}/`)) return PASS;
    res.setHeader("cache-control", "no-store");
    if (path === BASE && method === "GET") return json(res, 200, grupos.estado());
    if (path === BASE && method === "PATCH") {
      const body = await readBody(req, 64 * 1024).catch(() => null) as Record<string, unknown> | null;
      if (!body || typeof body !== "object") return json(res, 400, { error: "Petición no válida." });
      const error = await grupos.cambiar(body);
      return json(res, error ? 400 : 200, error ? { error, ...grupos.estado() } : grupos.estado());
    }
    if (path === `${BASE}/telegram/token` && (method === "PUT" || method === "DELETE")) {
      let token: string | null = null;
      if (method === "PUT") {
        const body = await readBody(req, 4096).catch(() => null) as { token?: unknown } | null;
        token = typeof body?.token === "string" ? body.token.trim() : "";
      }
      const error = await grupos.ponerToken(token);
      return json(res, error ? 400 : 200, error ? { error } : grupos.estado());
    }
    if (path === `${BASE}/whatsapp/vincular` && method === "POST") { await grupos.vincularWhatsapp(); return json(res, 200, grupos.estado()); }
    if (path === `${BASE}/whatsapp/desvincular` && method === "POST") { await grupos.desvincularWhatsapp(); return json(res, 200, grupos.estado()); }
    return PASS;
  };
}
