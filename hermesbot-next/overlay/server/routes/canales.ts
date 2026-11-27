// OpenBot: Ajustes > Funciones > Bots en WhatsApp y Telegram (server/canales). Ámbito admin, el que request-auth da por
// defecto a una ruta nueva: ni un miembro sin permisos ni la consola de un bot llegan aquí.
//   GET    /api/canales                              estado (sin tokens ni ids de chat)
//   PATCH  /api/canales                              qué bots salen, avisos de una persona, contacto propio on/off
//   POST   /api/canales/personas                     { nombre, clave? } → persona nueva y su código de vinculación
//   POST   /api/canales/personas/:id/codigo          otro código para esa persona
//   DELETE /api/canales/personas/:id[/whatsapp|/telegram]
//   PUT    /api/canales/bots/:id/telegram            { token } del contacto propio de ese bot; DELETE lo quita
import type { Canales } from "../canales/index.ts";
import { PASS, type RouteHandler } from "./table.ts";

const BASE = "/api/canales";

export function createCanalesRoutes(canales: Canales): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (path !== BASE && !path.startsWith(`${BASE}/`)) return PASS;
    res.setHeader("cache-control", "no-store");
    const cuerpo = async (max = 16 * 1024) => (await readBody(req, max).catch(() => null)) as Record<string, unknown> | null;
    if (path === BASE && method === "GET") return json(res, 200, canales.estado());
    if (path === BASE && method === "PATCH") {
      const body = await cuerpo();
      if (!body || typeof body !== "object") return json(res, 400, { error: "Petición no válida." });
      const error = canales.cambiar(body);
      return json(res, error ? 400 : 200, error ? { error } : canales.estado());
    }
    if (path === `${BASE}/personas` && method === "POST") {
      const body = await cuerpo();
      const nombre = typeof body?.nombre === "string" ? body.nombre : "";
      const clave = typeof body?.clave === "string" && body.clave ? body.clave : undefined;
      const hecho = canales.crearPersona(nombre, clave);
      return json(res, "error" in hecho ? 400 : 200, "error" in hecho ? hecho : { ...hecho, estado: canales.estado() });
    }
    const persona = /^\/api\/canales\/personas\/([\w-]{1,64})(?:\/(codigo|whatsapp|telegram))?$/.exec(path);
    if (persona) {
      const [, id, que] = persona as unknown as [string, string, string | undefined];
      if (!canales.personaPorId(id)) return json(res, 404, { error: "Esa persona ya no está." });
      if (que === "codigo" && method === "POST") return json(res, 200, canales.nuevoCodigo(id));
      if (method === "DELETE" && que !== "codigo") {
        canales.quitar(id, (que as "whatsapp" | "telegram" | undefined) ?? "todo");
        return json(res, 200, canales.estado());
      }
      return PASS;
    }
    const token = /^\/api\/canales\/bots\/([\w-]{1,128})\/telegram$/.exec(path);
    if (token && (method === "PUT" || method === "DELETE")) {
      const body = method === "PUT" ? await cuerpo(4096) : null;
      const valor = method === "PUT" ? (typeof body?.token === "string" ? body.token.trim() : "") : null;
      const error = await canales.ponerTokenPropio(token[1]!, valor);
      return json(res, error ? 400 : 200, error ? { error } : canales.estado());
    }
    return PASS;
  };
}
