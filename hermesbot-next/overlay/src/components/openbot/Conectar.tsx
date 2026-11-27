// OpenBot: portada de Conectores y hoja de conexión paso a paso (patches/95-conectores.patch la usa desde PluginsPanel).
// Todo se conecta aquí mismo, sin mandar a la persona a Ajustes. Aspecto de Grok Bot: tarjetas blancas con borde fino y
// sombra suave, todo en tinta y gris, el color de cada app solo en su icono. Textos en español: esta parte es solo de OpenBot.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, AudioLines, Blocks, BrainCircuit, GitBranch, TrainFront, CalendarDays, Check, ChevronRight, Clapperboard, ExternalLink, Loader2, Mail, MessageCircle, NotebookText, Plug, Plus, Send, X, type LucideIcon } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { loadAppCatalog } from "@/lib/app-catalog-cache";
import { McpServersPanel } from "../McpServersPanel";
import { GruposSettings } from "../settings/GruposSettings";
import { EnginesSettings } from "../EnginesSettings";
import { GithubAppCard } from "../github/GithubAppCard";
import { useGithubShown } from "@/lib/github-sign-in";
import type { HostedConnections } from "@/lib/hosted-mcp-apps";

type Tipo = "composio" | "mcp" | "grupos" | "propio" | "puente" | "modelos" | "github";
export interface Recomendado { id: string; nombre: string; frase: string; detalle: string; icono: LucideIcon; color: string; tipo: Tipo; slug?: string }

/** Composio Connect (claves ck_): un servidor MCP con todas las apps que la persona conecte en su cuenta de Composio. */
const CONNECT_URL = "https://connect.composio.dev/mcp";
const CONNECT_NAME = "composio-connect"; // "composio" lo reserva la base para su propia conexión.

const APPS: readonly Recomendado[] = [
  { id: "gmail", slug: "gmail", nombre: "Gmail", frase: "Lee y redacta correos", icono: Mail, color: "#EA4335", tipo: "composio",
    detalle: "Tus bots podrán leer, buscar, resumir y redactar correos de tu cuenta de Gmail." },
  { id: "googlecalendar", slug: "googlecalendar", nombre: "Google Calendar", frase: "Consulta y crea eventos", icono: CalendarDays, color: "#4285F4", tipo: "composio",
    detalle: "Tus bots podrán ver tu agenda, buscar huecos y crear o mover eventos." },
  { id: "notion", nombre: "Notion", frase: "Páginas y bases de datos", icono: NotebookText, color: "currentColor", tipo: "mcp",
    detalle: "Tus bots podrán leer y escribir en las páginas y bases de datos que compartas." },
  { id: "higgsfield", nombre: "Higgsfield", frase: "Imágenes y vídeos con IA", icono: Clapperboard, color: "#8B5CF6", tipo: "mcp",
    detalle: "Tus bots podrán crear imágenes y vídeos con IA usando tu cuenta y tus créditos de Higgsfield." },
  { id: "elevenlabs", nombre: "ElevenLabs", frase: "Voces y audio con IA", icono: AudioLines, color: "#F59E0B", tipo: "mcp",
    detalle: "Tus bots podrán crear voces, audios y efectos de sonido con tu cuenta de ElevenLabs." },
];
const MENSAJERIA: readonly Recomendado[] = [
  { id: "telegram", nombre: "Telegram", frase: "Tus bots en tus grupos", icono: Send, color: "#229ED9", tipo: "grupos",
    detalle: "El bot entra en tus grupos de Telegram, guarda lo importante y, si quieres, responde cuando lo mencionan." },
  { id: "whatsapp", nombre: "WhatsApp", frase: "Tus bots en tus grupos", icono: MessageCircle, color: "#25D366", tipo: "grupos",
    detalle: "El bot entra en tus grupos de WhatsApp, guarda lo importante y, si quieres, responde cuando lo mencionan." },
];
const DESARROLLO: readonly Recomendado[] = [
  { id: "github", nombre: "GitHub", frase: "Repositorios, issues y PR", icono: GitBranch, color: "currentColor", tipo: "github",
    detalle: "Tus bots podrán leer tus repositorios, abrir issues y preparar cambios y pull requests en tu cuenta de GitHub." },
  { id: "railway", nombre: "Railway", frase: "Despliegues y registros", icono: TrainFront, color: "#853BCE", tipo: "mcp",
    detalle: "Tus bots podrán ver tus proyectos de Railway, revisar despliegues y registros y cambiar variables." },
];
const MODELOS: Recomendado = { id: "modelos", nombre: "Modelos de IA", frase: "Hermes, ChatGPT, Claude…", icono: BrainCircuit, color: "currentColor", tipo: "modelos",
  detalle: "El cerebro de tus bots. Conecta tu cuenta de ChatGPT, Claude u otro proveedor y elige qué modelo usa Hermes." };
const PUENTE: Recomendado = { id: "composio", nombre: "Composio", frase: "Puente a más de 500 apps", icono: Blocks, color: "currentColor", tipo: "puente",
  detalle: "Composio conecta tus bots con Gmail, Calendar, Slack, Drive y cientos de apps más de forma segura. Se activa una vez y sirve para todas." };
const PROPIO: Recomendado = { id: "propio", nombre: "Mi propia app", frase: "Cualquier servidor MCP", icono: Plus, color: "currentColor", tipo: "propio",
  detalle: "Conecta tus propias aplicaciones o cualquier servicio con servidor MCP: solo necesitas su dirección y, si la pide, una clave o iniciar sesión." };

export const RECOMENDADOS: readonly Recomendado[] = [MODELOS, PUENTE, ...APPS, ...DESARROLLO, ...MENSAJERIA, PROPIO];

/** Cualquier app del catálogo, cuando aún falta Composio: la misma hoja, con su nombre. */
export function deCatalogo(slug: string, nombre: string): Recomendado {
  return { id: slug, slug, nombre, frase: "", detalle: `Tus bots podrán usar ${nombre} desde el chat.`, icono: Plug, color: "currentColor", tipo: "composio" };
}

// La tarjeta blanca de Grok Bot: borde fino y sombra suave, sobre el fondo gris claro del panel.
const tarjeta = "rounded-[20px] bg-[var(--color-composer)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-ink)_8%,transparent),0_1px_4px_rgb(0_0_0/0.05)]";
const boton = "inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-[14px] font-medium transition-colors disabled:opacity-50";
const principal = cn(boton, "bg-ink text-app hover:opacity-90");
const secundario = cn(boton, "bg-ink/[0.06] text-ink hover:bg-ink/10");
const nota = "text-[14px] leading-6 text-ink-secondary";

/** Si Composio Connect (ck_) está añadido como servidor MCP. Lo leen la portada y las hojas. */
export function useComposioConnect(): { puesto: boolean; recargar: () => void } {
  const [puesto, setPuesto] = useState(false);
  const recargar = useCallback(() => {
    api("/api/mcp/servers").then((r: { servers?: Array<{ url?: string; enabled?: boolean }> }) => {
      setPuesto((r.servers ?? []).some((s) => typeof s.url === "string" && s.url.startsWith(CONNECT_URL) && s.enabled !== false));
    }).catch(() => {});
  }, []);
  useEffect(recargar, [recargar]);
  return { puesto, recargar };
}

/** Lo que la persona marcó como hecho en su cuenta de Composio Connect (allí no hay forma de preguntarlo desde aquí). */
function hechoEnComposio(id: string): boolean {
  try { return localStorage.getItem(`openbot-composio-${id}`) === "1"; } catch { return false; }
}
function marcarEnComposio(id: string) {
  try { localStorage.setItem(`openbot-composio-${id}`, "1"); } catch { /* sin almacenamiento: solo dura esta visita */ }
}

function Icono({ item, size = "md" }: { item: Recomendado; size?: "md" | "lg" }) {
  const Glyph = item.icono;
  return (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center bg-ink/[0.05] text-ink", size === "lg" ? "size-16 rounded-[20px]" : "size-11 rounded-2xl")}
      style={item.color === "currentColor" ? undefined : { color: item.color }}>
      <Glyph size={size === "lg" ? 30 : 22} strokeWidth={1.7} />
    </span>
  );
}

function Estado({ on }: { on: boolean }) {
  return on
    ? <span className="inline-flex items-center gap-1 text-[13px] font-medium text-success"><span className="flex size-4 items-center justify-center rounded-full bg-success text-white"><Check size={10} strokeWidth={3.5} /></span>Conectado</span>
    : <span className="inline-flex items-center gap-0.5 text-[13px] font-medium text-ink-secondary group-hover:text-ink">Conectar<ChevronRight size={14} className="rtl:-scale-x-100" /></span>;
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="px-1 text-[13px] font-medium text-ink-secondary">{titulo}</h3>
      {children}
    </section>
  );
}

/** La portada: lo esencial arriba, las apps y la mensajería después, y el catálogo completo detrás de un enlace. */
export function ConectarInicio({ conectado, onAbrir, onCatalogo }: { conectado: (item: Recomendado) => boolean; onAbrir: (item: Recomendado) => void; onCatalogo: () => void }) {
  const fila = (item: Recomendado) => (
    <button key={item.id} type="button" data-openbot-rec={item.id} onClick={() => onAbrir(item)}
      className={cn(tarjeta, "group flex min-w-0 items-center gap-3.5 p-3.5 text-start transition-transform hover:-translate-y-px")}>
      <Icono item={item} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-5 text-ink">{item.nombre}</span>
        <span className="mt-0.5 block truncate text-[13px] leading-5 text-ink-secondary">{item.frase}</span>
      </span>
      {item.tipo !== "propio" && <Estado on={conectado(item)} />}
    </button>
  );
  return (
    <div data-openbot-inicio className="flex flex-col gap-7 pt-1">
      <Seccion titulo="Lo esencial"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{[MODELOS, PUENTE].map(fila)}</div></Seccion>
      <Seccion titulo="Apps"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{APPS.map(fila)}</div></Seccion>
      <Seccion titulo="Desarrollo"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{DESARROLLO.map(fila)}{fila(PROPIO)}</div></Seccion>
      <Seccion titulo="Mensajería"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{MENSAJERIA.map(fila)}</div></Seccion>
      <button type="button" onClick={onCatalogo} className={cn(secundario, "self-center")}>Ver todas las apps</button>
    </div>
  );
}

function Paso({ n, titulo, hecho, activo, ultimo = false, children }: { n: number; titulo: string; hecho: boolean; activo: boolean; ultimo?: boolean; children?: ReactNode }) {
  return (
    <li className={cn("relative flex gap-4", !ultimo && "pb-7")}>
      {!ultimo && <span aria-hidden="true" className={cn("absolute start-[15px] top-9 bottom-1 w-px", hecho ? "bg-success/40" : "bg-ink/10")} />}
      <span className={cn("relative flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold transition-colors",
        hecho ? "bg-success text-white" : activo ? "bg-ink text-app" : "bg-ink/[0.06] text-ink-secondary")}>
        {hecho ? <Check size={15} strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <div className={cn("text-[15px] font-semibold leading-6", activo || hecho ? "text-ink" : "text-ink-secondary")}>{titulo}</div>
        {activo && children && <div className="mt-3 flex flex-col gap-3.5">{children}</div>}
      </div>
    </li>
  );
}

/** Pegar la clave de Composio. Vale cualquiera de las dos que da Composio: la de Connect (ck_) o la de proyecto (ak_). */
function ClaveComposio({ onHecho }: { onHecho: () => void }) {
  const [clave, setClave] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const guardar = async () => {
    const valor = clave.trim();
    if (/^(oak|uak)_/.test(valor)) { setFallo(`Esa es tu clave ${valor.startsWith("oak_") ? "de organización" : "de usuario"} de Composio. Copia la que empieza por «ck_» (Composio Connect) o por «ak_» (clave de proyecto).`); return; }
    if (!/^(ck|ak)_/.test(valor)) { setFallo("Esa no parece una clave de Composio. Debe empezar por «ck_» o por «ak_»."); return; }
    setGuardando(true); setFallo(null);
    try {
      if (valor.startsWith("ck_")) {
        const entrada = { type: "http", url: CONNECT_URL, headers: { "x-consumer-api-key": valor }, enabled: false };
        const lista: { servers?: Array<{ name: string }> } = await api("/api/mcp/servers");
        const existe = (lista.servers ?? []).some((s) => s.name === CONNECT_NAME);
        await api(existe ? `/api/mcp/servers/${CONNECT_NAME}` : "/api/mcp/servers", { method: existe ? "PUT" : "POST", body: JSON.stringify(existe ? entrada : { name: CONNECT_NAME, ...entrada }) });
        const prueba: { ok?: boolean; error?: string } = await api(`/api/mcp/servers/${CONNECT_NAME}/test`, { method: "POST" }).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
        if (!prueba.ok) { setFallo(`Composio no ha aceptado la clave${prueba.error ? ` (${prueba.error})` : ""}. Si la acabas de regenerar, copia la nueva y pégala otra vez.`); return; }
        await api(`/api/mcp/servers/${CONNECT_NAME}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
      } else {
        await api("/api/config", { method: "PUT", body: JSON.stringify({ composio: { apiKey: valor } }) });
        const catalogo = await loadAppCatalog();
        if (!catalogo.configured) { setFallo("La clave se guardó pero Composio no la acepta. Revisa que sea la clave del proyecto y pégala otra vez."); return; }
      }
      setClave("");
      onHecho();
    } catch (e) { setFallo(e instanceof Error ? e.message : String(e)); } finally { setGuardando(false); }
  };
  return <>
    <ol className={cn(tarjeta, "flex flex-col gap-2 p-4 text-[14px] leading-6 text-ink")}>
      <li><b>1.</b> Entra en Composio con tu cuenta (es gratis).</li>
      <li><b>2.</b> Copia tu clave. Sirven las que empiezan por <code className="rounded bg-ink/[0.06] px-1.5">ck_</code> (Composio Connect, la más sencilla) o por <code className="rounded bg-ink/[0.06] px-1.5">ak_</code> (clave de proyecto).</li>
      <li><b>3.</b> Pégala aquí abajo.</li>
    </ol>
    <a href="https://composio.dev" target="_blank" rel="noreferrer" className={cn(secundario, "self-start")}>Abrir Composio <ExternalLink size={14} /></a>
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (clave.trim()) void guardar(); }}>
      <input type="password" autoComplete="off" spellCheck={false} value={clave} onChange={(e) => setClave(e.target.value)} placeholder="ck_…  o  ak_…" aria-label="Clave de Composio"
        className={cn(tarjeta, "h-11 min-w-0 flex-1 px-4 text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none focus:ring-2 focus:ring-ink/20")} />
      <button type="submit" disabled={guardando || !clave.trim()} className={cn(principal, "h-11")}>
        {guardando && <Loader2 size={15} className="animate-spin" />}{guardando ? "Comprobando" : "Guardar"}
      </button>
    </form>
    {fallo && <p role="alert" className="rounded-2xl bg-danger/10 px-4 py-3 text-[13px] leading-5 text-danger">{fallo}</p>}
  </>;
}

/** La hoja que se abre encima del panel al elegir algo: qué hace, y sus pasos hasta "Listo". */
export function HojaConexion({ item, conectado, clavePuesta, connectPuesto, remoto, ocupado, enlace, onConectar, onHosted, onComposio, onAcceso, onCerrar }: {
  item: Recomendado; conectado: boolean; clavePuesta: boolean; connectPuesto: boolean; remoto: boolean; ocupado: boolean; enlace?: string;
  onConectar: (slug: string) => void; onHosted: (connections: HostedConnections) => void; onComposio: () => void; onAcceso: () => void; onCerrar: () => void;
}) {
  const [marcado, setMarcado] = useState(() => hechoEnComposio(item.id));
  const puente = clavePuesta || connectPuesto;
  const listo = (texto?: string) => (
    <div className={cn(tarjeta, "flex flex-col gap-3 p-4")}>
      <p className="text-[15px] font-semibold text-ink">¡Listo! {item.nombre} está conectado.</p>
      <p className={nota}>{texto ?? `Pídeselo a tus bots en el chat, por ejemplo: «${ejemplo(item.id)}».`}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onCerrar} className={principal}>Hecho</button>
        {item.tipo !== "puente" && <button type="button" onClick={onAcceso} className={secundario}>Elegir qué bots lo usan</button>}
      </div>
    </div>
  );
  const pasoPuente = (n: number, ultimo = false) => (
    <Paso n={n} ultimo={ultimo} titulo={item.tipo === "puente" ? "Pega tu clave de Composio" : "Activa Composio (solo la primera vez)"} hecho={puente} activo={!puente}>
      {item.tipo !== "puente" && <p className={nota}>OpenBot usa Composio para conectarse con {item.nombre} de forma segura. Se hace una vez y sirve para todas las apps.</p>}
      {remoto ? <p className={nota}>Esto se configura en el ordenador o servidor donde está instalado OpenBot.</p> : <ClaveComposio onHecho={onComposio} />}
    </Paso>
  );
  return (
    <div data-openbot-hoja={item.id} className="absolute inset-0 z-20 flex flex-col bg-app">
      <div className="flex items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <button type="button" onClick={onCerrar} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] text-ink-secondary hover:bg-ink/[0.06] hover:text-ink"><ArrowLeft size={16} className="rtl:-scale-x-100" />Conectores</button>
        <button type="button" onClick={onCerrar} aria-label="Cerrar" className="flex size-9 items-center justify-center rounded-full text-ink-secondary hover:bg-ink/[0.06] hover:text-ink"><X size={17} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-2 sm:px-8">
        <div className="mx-auto flex max-w-[560px] flex-col gap-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <Icono item={item} size="lg" />
            <h3 className="text-[24px] font-semibold leading-8 tracking-[-0.02em] text-ink">{item.nombre}</h3>
            <p className={cn(nota, "max-w-[440px]")}>{item.detalle}</p>
          </div>

          {item.tipo === "puente" && (
            <ol>
              {pasoPuente(1)}
              <Paso n={2} ultimo titulo="Listo para usar" hecho={puente} activo={puente}>
                {listo(connectPuesto
                  ? "Ya puedes conectar Gmail, Calendar y cualquier otra app: ábrela aquí o pídeselo a tu bot en el chat («conecta mi Gmail») y te dará el enlace."
                  : "Ya puedes conectar Gmail, Calendar y cualquier otra app desde aquí.")}
              </Paso>
            </ol>
          )}

          {item.tipo === "composio" && item.slug && (
            <ol>
              {pasoPuente(1)}
              {connectPuesto && !clavePuesta ? <>
                <Paso n={2} titulo={`Da permiso a ${item.nombre}`} hecho={conectado || marcado} activo={puente && !conectado && !marcado}>
                  <p className={nota}>Escríbele a tu bot en el chat:</p>
                  <p className={cn(tarjeta, "px-4 py-3 text-[15px] font-medium text-ink")}>«Conecta mi {item.nombre}»</p>
                  <p className={nota}>Te responderá con un enlace de Google. Ábrelo, elige tu cuenta y pulsa «Permitir». Después vuelve aquí.</p>
                  <button type="button" onClick={() => { marcarEnComposio(item.id); setMarcado(true); }} className={cn(principal, "self-start")}>Ya lo he conectado</button>
                </Paso>
                <Paso n={3} ultimo titulo="Listo para usar" hecho={conectado || marcado} activo={conectado || marcado}>{listo()}</Paso>
              </> : <>
                <Paso n={2} titulo={`Inicia sesión con tu cuenta de ${item.nombre}`} hecho={conectado} activo={puente && !conectado}>
                  <p className={nota}>Se abrirá una ventana. Elige tu cuenta y pulsa «Permitir». Después vuelve aquí: esto se actualiza solo.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={ocupado} onClick={() => onConectar(item.slug!)} className={principal}>
                      {ocupado && <Loader2 size={15} className="animate-spin" />}{enlace ? "Volver a intentarlo" : `Conectar ${item.nombre}`}
                    </button>
                    {enlace && <a href={enlace} target="_blank" rel="noreferrer" className={secundario}>Abrir la ventana otra vez <ExternalLink size={14} /></a>}
                  </div>
                  {enlace && <p className="flex items-center gap-2 text-[14px] text-ink-secondary"><Loader2 size={14} className="animate-spin" />Esperando a que autorices…</p>}
                </Paso>
                <Paso n={3} ultimo titulo="Listo para usar" hecho={conectado} activo={conectado}>{listo()}</Paso>
              </>}
            </ol>
          )}

          {item.tipo === "mcp" && (
            <ol>
              <Paso n={1} titulo={`Inicia sesión en ${item.nombre}`} hecho={conectado} activo={!conectado}>
                <p className={nota}>No hace falta ninguna clave. Pulsa «Conectar», inicia sesión con tu cuenta y acepta. Después vuelve aquí.</p>
                <div className={cn(tarjeta, "grid grid-cols-1 p-2")}><McpServersPanel hostedCards={{ shown: (id) => id === item.id, onConnections: onHosted }} /></div>
              </Paso>
              <Paso n={2} ultimo titulo="Listo para usar" hecho={conectado} activo={conectado}>{listo()}</Paso>
            </ol>
          )}

          {item.tipo === "github" && <HojaGithub conectado={conectado} listo={listo()} />}

          {item.tipo === "modelos" && (
            <div className="flex flex-col gap-4">
              <p className={cn(tarjeta, "p-4 text-[14px] leading-6 text-ink")}>Elige con qué cuenta piensan tus bots. Lo más fácil: <b>conectar tu suscripción de ChatGPT</b> (sin clave, solo iniciar sesión). También puedes usar Claude, una clave de API u otro proveedor.</p>
              <div className="openbot-modelos-hoja"><EnginesSettings simple /></div>
            </div>
          )}

          {item.tipo === "grupos" && (
            <div className="flex flex-col gap-4">
              <p className={nota}>Sigue los pasos de {item.nombre} aquí abajo. Al terminar, el bot aparecerá como conectado y verás tus grupos.</p>
              <div className="openbot-grupos-hoja"><GruposSettings /></div>
            </div>
          )}

          {item.tipo === "propio" && (
            <div className="flex flex-col gap-4">
              <ol className={cn(tarjeta, "flex flex-col gap-2 p-4 text-[14px] leading-6 text-ink")}>
                <li><b>1.</b> Pulsa «Añadir servidor».</li>
                <li><b>2.</b> Ponle un nombre y pega la dirección MCP de tu app (suele acabar en <code className="rounded bg-ink/[0.06] px-1.5">/mcp</code>).</li>
                <li><b>3.</b> Si te lo pide, inicia sesión o pega su clave. OpenBot lo prueba y lo activa.</li>
              </ol>
              <McpServersPanel embedded />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** GitHub tiene su propio inicio de sesión en la base; esta hoja lo pone en pasos. */
function HojaGithub({ conectado, listo }: { conectado: boolean; listo: ReactNode }) {
  const disponible = useGithubShown();
  if (!disponible) return <p className={cn(tarjeta, "p-4 text-[14px] leading-6 text-ink")}>GitHub no está disponible en esta instalación. Puedes conectarlo igualmente con su servidor MCP en «Mi propia app».</p>;
  return (
    <ol>
      <Paso n={1} titulo="Inicia sesión con tu cuenta de GitHub" hecho={conectado} activo={!conectado}>
        <p className={nota}>Pulsa «Conectar» y sigue los pasos que te pida GitHub. Después vuelve aquí.</p>
        <div className={cn(tarjeta, "grid grid-cols-1 p-2")}><GithubAppCard /></div>
      </Paso>
      <Paso n={2} ultimo titulo="Listo para usar" hecho={conectado} activo={conectado}>{listo}</Paso>
    </ol>
  );
}

function ejemplo(id: string): string {
  switch (id) {
    case "gmail": return "resúmeme los correos importantes de hoy";
    case "googlecalendar": return "¿qué tengo mañana en la agenda?";
    case "notion": return "apunta esta idea en mi página de Notion";
    case "higgsfield": return "crea una imagen de portada para mi post";
    case "elevenlabs": return "lee este texto con una voz cálida";
    case "github": return "revisa los issues abiertos de mi repositorio";
    case "railway": return "¿por qué ha fallado el último despliegue?";
    default: return "ayúdame con esto";
  }
}
