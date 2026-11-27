// OpenBot: los modelos de Hermes, como en su propia app (`hermes model`). Ajustes > IA > «Modelos de Hermes» lee y cambia:
// - el modelo general de Hermes (model.provider y model.default de su config.yaml, vía `hermes config set`),
// - las cuentas y claves de cada proveedor (claves en HERMES_HOME/.env; aquí solo se dice si hay una, nunca cuál),
// - qué modelo usa cada bot (el general de Hermes o uno concreto de su catálogo).
// Además, todos los bots usan Hermes como motor: una vez al arrancar se pasan a Hermes los que usaban otro, y los
// bots nuevos nacen con Hermes (defaultModelSelection).
import { execFile } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fetchHermesAcpModels, HERMES_CONFIG_MODEL_ID } from "./drivers/acp/hermes.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export const HERMES_INSTANCE_ID = "hermes";

interface Provider { id: string; name: string; kind: "oauth" | "key"; keys?: readonly string[]; hint?: string; url?: string }

/** Los de la app de Hermes que más se usan, en el orden en que los enseña. Ids y variables de su PROVIDER_REGISTRY. */
export const HERMES_PROVIDERS: readonly Provider[] = [
  { id: "openai-codex", name: "ChatGPT", kind: "oauth", hint: "Tu suscripción de ChatGPT (Plus o Pro)." },
  { id: "nous", name: "Nous Portal", kind: "oauth", hint: "Más de 300 modelos, con plan gratuito." },
  { id: "anthropic", name: "Anthropic (Claude)", kind: "key", keys: ["ANTHROPIC_API_KEY"], url: "https://console.anthropic.com/settings/keys" },
  { id: "openrouter", name: "OpenRouter", kind: "key", keys: ["OPENROUTER_API_KEY"], url: "https://openrouter.ai/keys", hint: "Cientos de modelos con una sola clave." },
  { id: "openai-api", name: "OpenAI API", kind: "key", keys: ["OPENAI_API_KEY"], url: "https://platform.openai.com/api-keys" },
  { id: "gemini", name: "Google Gemini", kind: "key", keys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], url: "https://aistudio.google.com/apikey" },
  { id: "xai", name: "xAI Grok", kind: "key", keys: ["XAI_API_KEY"], url: "https://console.x.ai" },
  { id: "deepseek", name: "DeepSeek", kind: "key", keys: ["DEEPSEEK_API_KEY"], url: "https://platform.deepseek.com/api_keys" },
  { id: "zai", name: "Z.AI / GLM", kind: "key", keys: ["GLM_API_KEY", "ZAI_API_KEY", "Z_AI_API_KEY"], url: "https://z.ai/manage-apikey/apikey-list" },
  { id: "kimi-coding", name: "Kimi / Moonshot", kind: "key", keys: ["KIMI_API_KEY"], url: "https://platform.moonshot.ai" },
  { id: "minimax", name: "MiniMax", kind: "key", keys: ["MINIMAX_API_KEY"] },
  { id: "alibaba", name: "Qwen Cloud", kind: "key", keys: ["DASHSCOPE_API_KEY"] },
  { id: "fireworks", name: "Fireworks AI", kind: "key", keys: ["FIREWORKS_API_KEY"] },
  { id: "huggingface", name: "Hugging Face", kind: "key", keys: ["HF_TOKEN"] },
  { id: "ollama-cloud", name: "Ollama Cloud", kind: "key", keys: ["OLLAMA_API_KEY"] },
];

const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

export interface HermesModelsDeps {
  home: () => string;
  env: () => Record<string, string | undefined>;
  bots: () => readonly { id: string; name: string; color?: string; modelSelection?: { instanceId: string; model: string } }[];
  setBotModel: (botId: string, model: string) => void;
  setDefault: () => void;
  changed: () => void;
}

function readText(path: string): string { try { return readFileSync(path, "utf8"); } catch { return ""; } }

function envHas(text: string, name: string): boolean {
  return new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[ \\t]*["']?[^\\s"'#]`, "m").test(text);
}

/** El modelo general de config.yaml: `model:` con `default`/`provider` debajo (o un valor suelto). */
export function readHermesDefault(yaml: string): { provider: string; model: string } {
  const block = /^model:[ \t]*(.*)\n((?:[ \t]+.*\n?|[ \t]*\n)*)/m.exec(yaml);
  if (!block) return { provider: "", model: "" };
  const inline = block[1].replace(/#.*/, "").trim().replace(/^["']|["']$/g, "");
  const field = (name: string) => new RegExp(`^[ \\t]+${name}:[ \\t]*["']?([^"'\\n#]*)`, "m").exec(block[2])?.[1].trim() ?? "";
  return { provider: field("provider"), model: inline || field("default") || field("model") };
}

function run(args: readonly string[], env: Record<string, string | undefined>): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile("hermes", [...args], { env: env as NodeJS.ProcessEnv, timeout: 30_000 }, (error, stdout, stderr) => {
      resolve({ ok: !error, out: `${stdout}\n${stderr}` });
    });
  });
}

/** Proveedores con cuenta o clave: auth.json (cuentas) y .env (claves). Solo nombres, nunca valores. */
function providerStatus(deps: HermesModelsDeps) {
  const home = deps.home();
  const dotenv = readText(join(home, ".env"));
  let pool: Record<string, unknown> = {};
  try {
    const auth = JSON.parse(readText(join(home, "auth.json")) || "{}") as { providers?: object; credential_pool?: Record<string, unknown> };
    pool = { ...(auth.providers ?? {}), ...(auth.credential_pool ?? {}) };
  } catch {}
  const env = deps.env();
  return HERMES_PROVIDERS.map((provider) => {
    const inPool = Object.hasOwn(pool, provider.id) && (!Array.isArray(pool[provider.id]) || (pool[provider.id] as unknown[]).length > 0);
    const keyed = (provider.keys ?? []).some((name) => envHas(dotenv, name) || Boolean(env[name]?.trim()));
    return { id: provider.id, name: provider.name, kind: provider.kind, hint: provider.hint, url: provider.url, connected: inPool || keyed };
  });
}

let catalogCache: { at: number; list: { id: string; label: string }[] } | null = null;
async function catalog(deps: HermesModelsDeps, fresh = false) {
  if (!fresh && catalogCache && Date.now() - catalogCache.at < 5 * 60_000) return catalogCache.list;
  const list = (await fetchHermesAcpModels("hermes", deps.env())).map(({ id, label }) => ({ id, label }));
  if (list.length) catalogCache = { at: Date.now(), list };
  return list;
}

function writeKey(home: string, name: string, value: string | null) {
  const path = join(home, ".env");
  const lines = readText(path).split("\n").filter((line) => !new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=`).test(line));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (value) lines.push(`${name}=${JSON.stringify(value)}`);
  writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch {}
}

/** Una vez: todos los bots y los nuevos usan Hermes. Quien luego cambie un bot a otro motor, lo conserva. */
export function moveBotsToHermesOnce(deps: HermesModelsDeps, dataDir: string, hermesReady: boolean): number {
  const mark = join(dataDir, "openbot-hermes-default");
  if (!hermesReady || existsSync(mark)) return 0;
  let moved = 0;
  for (const bot of deps.bots()) {
    if (bot.modelSelection?.instanceId === HERMES_INSTANCE_ID) continue;
    deps.setBotModel(bot.id, HERMES_CONFIG_MODEL_ID);
    moved += 1;
  }
  deps.setDefault();
  writeFileSync(mark, `${new Date().toISOString()} ${moved}\n`);
  return moved;
}

export function createHermesModelsRoutes(deps: HermesModelsDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json: send, readBody: read }) => {
    if (!path.startsWith("/api/openbot/hermes")) return PASS;
    if (auth.kind !== "loopback" && !auth.scopes.includes("admin")) return send(res, 403, { error: "Solo un administrador cambia los modelos." });
    const env = deps.env();
    const home = deps.home();

    if (path === "/api/openbot/hermes" && method === "GET") {
      const fresh = new URL(req.url ?? "/", "http://x").searchParams.get("fresh") === "1";
      const current = readHermesDefault(readText(join(home, "config.yaml")));
      const models = await catalog(deps, fresh);
      return send(res, 200, {
        current,
        providers: providerStatus(deps),
        models,
        bots: deps.bots().map((bot) => ({
          id: bot.id, name: bot.name, color: bot.color,
          hermes: bot.modelSelection?.instanceId === HERMES_INSTANCE_ID,
          model: bot.modelSelection?.instanceId === HERMES_INSTANCE_ID ? bot.modelSelection.model : null,
        })),
      });
    }

    const body = method === "POST" ? await read(req, 64 * 1024) as Record<string, unknown> | null : null;
    const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

    if (path === "/api/openbot/hermes/default" && method === "POST") {
      // Del catálogo de Hermes llega `<proveedor>:<modelo>`.
      const id = text(body?.model);
      const cut = id.indexOf(":");
      if (cut <= 0 || cut === id.length - 1) return send(res, 400, { error: "Elige un modelo de la lista." });
      const provider = id.slice(0, cut), model = id.slice(cut + 1);
      const steps: string[][] = [["config", "set", "model.provider", provider], ["config", "set", "model.default", model]];
      steps.push(provider === "openai-codex" ? ["config", "set", "model.base_url", CODEX_BASE_URL] : ["config", "unset", "model.base_url"]);
      for (const step of steps) {
        const done = await run(step, env);
        if (!done.ok && step[1] !== "unset") return send(res, 500, { error: "Hermes no aceptó el cambio. Prueba otra vez." });
      }
      deps.changed();
      return send(res, 200, { ok: true, current: { provider, model } });
    }

    if (path === "/api/openbot/hermes/key" && method === "POST") {
      const provider = HERMES_PROVIDERS.find((one) => one.id === text(body?.provider) && one.kind === "key");
      if (!provider?.keys?.length) return send(res, 400, { error: "Ese proveedor no usa clave." });
      const key = text(body?.key);
      const remove = body?.remove === true;
      if (!remove && (key.length < 8 || /\s/.test(key))) return send(res, 400, { error: "Esa clave no parece válida." });
      if (remove) for (const name of provider.keys) writeKey(home, name, null);
      else writeKey(home, provider.keys[0], key);
      catalogCache = null;
      deps.changed();
      return send(res, 200, { ok: true });
    }

    if (path === "/api/openbot/hermes/logout" && method === "POST") {
      const provider = HERMES_PROVIDERS.find((one) => one.id === text(body?.provider) && one.kind === "oauth");
      if (!provider) return send(res, 400, { error: "Proveedor desconocido." });
      await run(["auth", "logout", provider.id], env);
      catalogCache = null;
      deps.changed();
      return send(res, 200, { ok: true });
    }

    if (path === "/api/openbot/hermes/bot" && method === "POST") {
      const botId = text(body?.botId);
      const model = text(body?.model) || HERMES_CONFIG_MODEL_ID;
      if (!deps.bots().some((bot) => bot.id === botId)) return send(res, 404, { error: "No encuentro ese bot." });
      deps.setBotModel(botId, model);
      return send(res, 200, { ok: true });
    }

    if (path === "/api/openbot/hermes/all" && method === "POST") {
      let moved = 0;
      for (const bot of deps.bots()) {
        if (bot.modelSelection?.instanceId === HERMES_INSTANCE_ID && bot.modelSelection.model === HERMES_CONFIG_MODEL_ID) continue;
        deps.setBotModel(bot.id, HERMES_CONFIG_MODEL_ID);
        moved += 1;
      }
      deps.setDefault();
      return send(res, 200, { ok: true, moved });
    }
    return PASS;
  };
}
