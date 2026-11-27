// OpenBot: portada de Conectores y hoja de conexión paso a paso (patches/95-conectores.patch la usa desde PluginsPanel).
// Todo se conecta aquí mismo, sin mandar a la persona a Ajustes. Textos en español directamente: esta parte es solo de OpenBot.
import { useState, type ReactNode } from "react";
import { ArrowLeft, AudioLines, CalendarDays, Check, Clapperboard, ExternalLink, Loader2, Mail, MessageCircle, NotebookText, Plug, Plus, Send, X, type LucideIcon } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { loadAppCatalog } from "@/lib/app-catalog-cache";
import { McpServersPanel } from "../McpServersPanel";
import { GruposSettings } from "../settings/GruposSettings";
import type { HostedConnections } from "@/lib/hosted-mcp-apps";

type Tipo = "composio" | "mcp" | "grupos" | "propio";
export interface Recomendado { id: string; nombre: string; frase: string; detalle: string; icono: LucideIcon; color: string; tipo: Tipo; slug?: string }

/** Cualquier app del catálogo, cuando aún falta la clave de Composio: la misma hoja, con su nombre. */
export function deCatalogo(slug: string, nombre: string): Recomendado {
  return { id: slug, slug, nombre, frase: "", detalle: `Tus bots podrán usar ${nombre} desde el chat.`, icono: Plug, color: "#64748B", tipo: "composio" };
}

export const RECOMENDADOS: readonly Recomendado[] = [
  { id: "gmail", slug: "gmail", nombre: "Gmail", frase: "Lee, busca y redacta correos", icono: Mail, color: "#EA4335", tipo: "composio",
    detalle: "Tus bots podrán leer, buscar, resumir y redactar correos de tu cuenta de Gmail." },
  { id: "googlecalendar", slug: "googlecalendar", nombre: "Google Calendar", frase: "Consulta y crea eventos", icono: CalendarDays, color: "#4285F4", tipo: "composio",
    detalle: "Tus bots podrán ver tu agenda, buscar huecos y crear o mover eventos." },
  { id: "notion", nombre: "Notion", frase: "Páginas, notas y bases de datos", icono: NotebookText, color: "#7C7C7C", tipo: "mcp",
    detalle: "Tus bots podrán leer y escribir en las páginas y bases de datos que compartas." },
  { id: "higgsfield", nombre: "Higgsfield", frase: "Imágenes y vídeos con IA", icono: Clapperboard, color: "#8B5CF6", tipo: "mcp",
    detalle: "Tus bots podrán crear imágenes y vídeos con IA usando tu cuenta y tus créditos de Higgsfield." },
  { id: "elevenlabs", nombre: "ElevenLabs", frase: "Voces y audio con IA", icono: AudioLines, color: "#F59E0B", tipo: "mcp",
    detalle: "Tus bots podrán crear voces, audios y efectos de sonido con tu cuenta de ElevenLabs." },
  { id: "telegram", nombre: "Telegram", frase: "Tus bots en tus grupos", icono: Send, color: "#229ED9", tipo: "grupos",
    detalle: "El bot entra en tus grupos de Telegram, guarda lo importante y, si quieres, responde cuando lo mencionan." },
  { id: "whatsapp", nombre: "WhatsApp", frase: "Tus bots en tus grupos", icono: MessageCircle, color: "#25D366", tipo: "grupos",
    detalle: "El bot entra en tus grupos de WhatsApp, guarda lo importante y, si quieres, responde cuando lo mencionan." },
];
const PROPIO: Recomendado = { id: "propio", nombre: "Mi propia app", frase: "Cualquier servidor MCP", icono: Plus, color: "#64748B", tipo: "propio",
  detalle: "Conecta tus propias aplicaciones o cualquier servicio que tenga servidor MCP: solo necesitas su dirección y, si la pide, una clave o iniciar sesión." };

function Icono({ item, size = "md" }: { item: Recomendado; size?: "md" | "lg" }) {
  const Glyph = item.icono;
  return (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center", size === "lg" ? "size-14 rounded-2xl" : "size-11 rounded-xl")}
      style={{ backgroundColor: `color-mix(in srgb, ${item.color} 16%, transparent)`, color: item.color }}>
      <Glyph size={size === "lg" ? 28 : 22} strokeWidth={1.8} />
    </span>
  );
}

export function Estado({ on }: { on: boolean }) {
  return on
    ? <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-[12px] font-medium text-success"><Check size={12} strokeWidth={2.5} />Conectado</span>
    : <span className="rounded-full bg-control px-2.5 py-1 text-[12px] font-medium text-ink-secondary">Conectar</span>;
}

/** La portada: solo lo que la gente busca primero, grande y claro. El catálogo completo queda detrás de un enlace. */
export function ConectarInicio({ conectado, onAbrir, onCatalogo }: { conectado: (item: Recomendado) => boolean; onAbrir: (item: Recomendado) => void; onCatalogo: () => void }) {
  const hechos = RECOMENDADOS.filter(conectado).length;
  return (
    <div data-openbot-inicio className="flex flex-col gap-6 pt-1">
      <p className="text-[13px] leading-5 text-ink-secondary">
        {hechos > 0 ? `Tienes ${hechos} ${hechos === 1 ? "app conectada" : "apps conectadas"}. ` : ""}Elige una app y te guiamos paso a paso. Todo se hace aquí mismo.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[...RECOMENDADOS, PROPIO].map((item) => {
          const on = item.tipo !== "propio" && conectado(item);
          return (
            <button key={item.id} type="button" data-openbot-rec={item.id} onClick={() => onAbrir(item)}
              className={cn("group flex min-w-0 flex-col items-start gap-3 rounded-2xl border p-4 text-start transition-all hover:-translate-y-0.5 hover:bg-raised-hover",
                item.tipo === "propio" ? "border-dashed border-hairline/80" : "border-hairline/40 bg-control/30")}>
              <Icono item={item} />
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold leading-5 text-ink">{item.nombre}</span>
                <span className="mt-0.5 block text-[12px] leading-4 text-ink-secondary">{item.frase}</span>
              </span>
              {item.tipo !== "propio" && <Estado on={on} />}
            </button>
          );
        })}
      </div>
      <button type="button" onClick={onCatalogo} className="self-center rounded-full px-4 py-2 text-[13px] font-medium text-ink-secondary hover:bg-raised hover:text-ink">
        Ver todas las apps (más de 500) →
      </button>
    </div>
  );
}

function Paso({ n, titulo, hecho, activo, ultimo = false, children }: { n: number; titulo: string; hecho: boolean; activo: boolean; ultimo?: boolean; children?: ReactNode }) {
  return (
    <li className={cn("relative flex gap-3.5", !ultimo && "pb-6")}>
      {!ultimo && <span aria-hidden="true" className="absolute start-[13px] top-8 bottom-1 w-px bg-hairline/60" />}
      <span className={cn("relative flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold",
        hecho ? "bg-success text-white" : activo ? "bg-ink text-app" : "bg-control text-ink-secondary")}>
        {hecho ? <Check size={14} strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className={cn("text-[14px] font-semibold leading-6", activo || hecho ? "text-ink" : "text-ink-secondary")}>{titulo}</div>
        {activo && children && <div className="mt-2 flex flex-col gap-3">{children}</div>}
      </div>
    </li>
  );
}

const boton = "inline-flex h-9 items-center justify-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors disabled:opacity-50";
const nota = "text-[13px] leading-5 text-ink-secondary";

function ClaveComposio() {
  const [clave, setClave] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const guardar = async () => {
    const valor = clave.trim();
    // Composio tiene varias claves; OpenBot necesita la del proyecto (ak_). Las demás se reconocen por su comienzo.
    const otra = /^oak_/.test(valor) ? "de organización" : /^uak_/.test(valor) ? "de usuario" : /^ck_/.test(valor) ? "de consumidor" : null;
    if (otra || !valor.startsWith("ak_")) {
      setFallo(`${otra ? `Esa es tu clave ${otra} de Composio, no la del proyecto.` : "Esa no parece la clave del proyecto."} Busca la que empieza por «ak_»: en Composio, entra en tu proyecto → Settings → API Keys y pulsa «Create API Key» si no tienes ninguna.`);
      return;
    }
    setGuardando(true); setFallo(null);
    try {
      await api("/api/config", { method: "PUT", body: JSON.stringify({ composio: { apiKey: valor } }) });
      setClave("");
      const catalogo = await loadAppCatalog();
      if (!catalogo.configured) setFallo("La clave se guardó pero Composio no la acepta. Revisa que sea la clave del proyecto (API key) y vuelve a pegarla.");
    } catch (e) { setFallo(e instanceof Error ? e.message : String(e)); } finally { setGuardando(false); }
  };
  return <>
    <p className={nota}>OpenBot usa <b className="text-ink">Composio</b> para conectarse con Google de forma segura. Es gratis y solo se hace una vez: después sirve para Gmail, Calendar y cientos de apps más.</p>
    <ol className="flex flex-col gap-1.5 rounded-xl bg-control/40 p-3 text-[13px] leading-5 text-ink">
      <li>1. Crea una cuenta gratis en Composio.</li>
      <li>2. Entra en tu proyecto → <b>Settings → API Keys</b>. Si no hay ninguna, pulsa <b>Create API Key</b>.</li>
      <li className="ps-4 text-ink-secondary">Copia la que empieza por <code className="rounded bg-app px-1 text-ink">ak_</code>. Las que empiezan por oak_, uak_ o ck_ no sirven aquí.</li>
      <li>3. Pégala aquí abajo.</li>
    </ol>
    <a href="https://app.composio.dev" target="_blank" rel="noreferrer" className={cn(boton, "self-start bg-control text-ink hover:bg-raised-hover")}>Abrir Composio <ExternalLink size={13} /></a>
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (clave.trim()) void guardar(); }}>
      <input type="password" autoComplete="off" spellCheck={false} value={clave} onChange={(e) => setClave(e.target.value)} placeholder="ak_… (clave del proyecto)" aria-label="Clave de Composio"
        className="h-9 min-w-0 flex-1 rounded-full bg-control/70 px-4 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none focus:ring-1 focus:ring-accent" />
      <button type="submit" disabled={guardando || !clave.trim()} className={cn(boton, "bg-ink text-app hover:opacity-90")}>
        {guardando && <Loader2 size={14} className="animate-spin" />}Guardar
      </button>
    </form>
    {fallo && <p role="alert" className="rounded-xl bg-danger/10 px-3 py-2 text-[12px] text-danger">{fallo}</p>}
  </>;
}

/** La hoja que se abre encima del panel al elegir una app: qué hace, y sus pasos hasta "Listo". */
export function HojaConexion({ item, conectado, clavePuesta, remoto, ocupado, enlace, onConectar, onHosted, onAcceso, onCerrar }: {
  item: Recomendado; conectado: boolean; clavePuesta: boolean; remoto: boolean; ocupado: boolean; enlace?: string;
  onConectar: (slug: string) => void; onHosted: (connections: HostedConnections) => void; onAcceso: () => void; onCerrar: () => void;
}) {
  const listo = (
    <div className="flex flex-col gap-3 rounded-2xl bg-success/10 p-4">
      <p className="text-[14px] font-semibold text-ink">¡Listo! {item.nombre} está conectado.</p>
      <p className={nota}>Pídeselo a tus bots en el chat, por ejemplo: «{ejemplo(item.id)}».</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onCerrar} className={cn(boton, "bg-ink text-app hover:opacity-90")}>Hecho</button>
        <button type="button" onClick={onAcceso} className={cn(boton, "bg-control text-ink hover:bg-raised-hover")}>Elegir qué bots lo usan</button>
      </div>
    </div>
  );
  return (
    <div data-openbot-hoja={item.id} className="absolute inset-0 z-20 flex flex-col bg-app">
      <div className="flex items-center justify-between gap-2 border-b border-hairline/40 px-4 py-3 sm:px-6">
        <button type="button" onClick={onCerrar} className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink"><ArrowLeft size={15} className="rtl:-scale-x-100" />Conectores</button>
        <button type="button" onClick={onCerrar} aria-label="Cerrar" className="flex size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"><X size={16} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-[560px] flex-col gap-6">
          <div className="flex items-center gap-4">
            <Icono item={item} size="lg" />
            <div className="min-w-0">
              <h3 className="text-[20px] font-semibold leading-7 tracking-[-0.01em] text-ink">{item.nombre}</h3>
              <p className={nota}>{item.detalle}</p>
            </div>
          </div>

          {item.tipo === "composio" && item.slug && (
            <ol>
              <Paso n={1} titulo="Activa la conexión con Google (solo la primera vez)" hecho={clavePuesta} activo={!clavePuesta}>
                {remoto ? <p className={nota}>Esto se configura en el ordenador o servidor donde está instalado OpenBot.</p> : <ClaveComposio />}
              </Paso>
              <Paso n={2} titulo={`Inicia sesión con tu cuenta de ${item.nombre}`} hecho={conectado} activo={clavePuesta && !conectado}>
                <p className={nota}>Se abrirá una ventana de Google. Elige tu cuenta y pulsa «Permitir». Después vuelve aquí: esto se actualiza solo.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" disabled={ocupado} onClick={() => onConectar(item.slug!)} className={cn(boton, "bg-ink text-app hover:opacity-90")}>
                    {ocupado && <Loader2 size={14} className="animate-spin" />}{enlace ? "Volver a intentarlo" : "Conectar con Google"}
                  </button>
                  {enlace && <a href={enlace} target="_blank" rel="noreferrer" className={cn(boton, "bg-control text-ink hover:bg-raised-hover")}>Abrir la ventana otra vez <ExternalLink size={13} /></a>}
                </div>
                {enlace && <p className="flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={13} className="animate-spin" />Esperando a que autorices en Google…</p>}
              </Paso>
              <Paso n={3} ultimo titulo="Listo para usar" hecho={conectado} activo={conectado}>{listo}</Paso>
            </ol>
          )}

          {item.tipo === "mcp" && (
            <ol>
              <Paso n={1} titulo={`Inicia sesión en ${item.nombre}`} hecho={conectado} activo={!conectado}>
                <p className={nota}>No hace falta ninguna clave. Pulsa «Conectar», inicia sesión con tu cuenta y acepta. Después vuelve aquí.</p>
                <div className="grid grid-cols-1"><McpServersPanel hostedCards={{ shown: (id) => id === item.id, onConnections: onHosted }} /></div>
              </Paso>
              <Paso n={2} ultimo titulo="Listo para usar" hecho={conectado} activo={conectado}>{listo}</Paso>
            </ol>
          )}

          {item.tipo === "grupos" && (
            <div className="flex flex-col gap-3">
              <p className={nota}>Sigue los pasos de {item.nombre} aquí abajo. Al terminar, el bot aparecerá como conectado y verás tus grupos.</p>
              <div className="openbot-grupos-hoja"><GruposSettings /></div>
            </div>
          )}

          {item.tipo === "propio" && (
            <div className="flex flex-col gap-3">
              <ol className="flex flex-col gap-1.5 rounded-xl bg-control/40 p-3 text-[13px] leading-5 text-ink">
                <li>1. Pulsa «Añadir servidor».</li>
                <li>2. Ponle un nombre y pega la dirección MCP de tu app (suele acabar en <code>/mcp</code>).</li>
                <li>3. Si te lo pide, inicia sesión o pega su clave. OpenBot lo prueba y lo activa.</li>
              </ol>
              <McpServersPanel embedded />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ejemplo(id: string): string {
  switch (id) {
    case "gmail": return "resúmeme los correos importantes de hoy";
    case "googlecalendar": return "¿qué tengo mañana en la agenda?";
    case "notion": return "apunta esta idea en mi página de Notion";
    case "higgsfield": return "crea una imagen de portada para mi post";
    case "elevenlabs": return "lee este texto con una voz cálida";
    default: return "ayúdame con esto";
  }
}
