// OpenBot: Ajustes > Funciones > Bots en WhatsApp y Telegram (server/canales, server/routes/canales.ts).
// Textos en español directamente: esta parte es solo de OpenBot.
import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "@/state/api";
import { SETTINGS_INPUT, SettingRow, SettingsGroup, SettingsRows, Switch } from "../SettingsPrimitives";

type Canal = "whatsapp" | "telegram";
interface Avisos { permisos: boolean; terminadas: boolean; fallos: boolean }
interface Estado {
  conexiones: { whatsapp: { conectado: boolean; numero: string | null }; telegram: { conectado: boolean; usuario: string | null } };
  personasOpenbot: Array<{ clave: string; nombre: string }>;
  personas: Array<{ id: string; nombre: string; clave: string | null; whatsapp: string | null; telegram: boolean; avisos: Avisos; avisosPor: Canal | null }>;
  bots: Array<{
    id: string; name: string; principal: boolean; jefe: boolean; whatsapp: boolean; telegram: boolean;
    contactoPropio: { activo: boolean; tokenPuesto: boolean; estado: string; error: string | null; usuario: string | null };
  }>;
}
interface Codigo { persona?: string; codigo: string; expira: number; whatsapp: string | null; telegram: string | null; telegramPropios: Array<{ bot: string; enlace: string }> }

const nota = "text-[12px] leading-5 text-ink-secondary";
const fallo = (texto?: string | null) => (texto ? <p role="alert" className="text-[12px] text-danger">{texto}</p> : null);
const SELECT = `${SETTINGS_INPUT} w-auto max-w-full pr-6`;
const AVISOS: Array<{ id: keyof Avisos; titulo: string; linea: string }> = [
  { id: "permisos", titulo: "Permisos y preguntas", linea: "Cuando un bot necesita tu permiso o te pregunta algo en cualquier conversación. Contestas desde el móvil." },
  { id: "terminadas", titulo: "Trabajos terminados", linea: "Cuando un bot termina un trabajo o una rutina en otra conversación." },
  { id: "fallos", titulo: "Fallos", linea: "Cuando una rutina o un trabajo falla." },
];

function Enlace({ titulo, url, pie }: { titulo: string; url: string; pie: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-hairline/40 p-3">
      <div className="shrink-0 rounded-md bg-white p-2"><QRCodeSVG value={url} size={112} /></div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="text-[13px] font-medium text-ink">{titulo}</div>
        <p className={nota}>{pie}</p>
        <a href={url} target="_blank" rel="noreferrer" className="break-all text-[12px] text-accent underline">{url}</a>
      </div>
    </div>
  );
}

function PanelCodigo({ codigo, nombre, cerrar }: { codigo: Codigo; nombre: string; cerrar: () => void }) {
  const minutos = Math.max(1, Math.round((codigo.expira - Date.now()) / 60000));
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent/5 p-3">
      <div className="text-[13px] text-ink">
        Código para vincular a <strong>{nombre}</strong>: <span className="ml-1 rounded-md bg-app px-2 py-0.5 font-mono text-[16px] tracking-wider">{codigo.codigo}</span>
        <span className={`${nota} ml-2`}>(vale {minutos} min, una sola vez)</span>
      </div>
      <p className={nota}>Desde el móvil de {nombre}, manda este código al bot. Lo más fácil: escanea un código QR con la cámara y pulsa enviar; el mensaje ya va escrito.</p>
      <div className="flex flex-col gap-2">
        {codigo.whatsapp && <Enlace titulo="WhatsApp" url={codigo.whatsapp} pie="Abre el chat con el número de OpenBot con el código escrito." />}
        {codigo.telegram && <Enlace titulo="Telegram (contacto general)" url={codigo.telegram} pie="Abre el bot de Telegram; pulsa «Iniciar»." />}
        {codigo.telegramPropios.map((p) => <Enlace key={p.enlace} titulo={`Telegram · ${p.bot}`} url={p.enlace} pie="Vale también para los demás contactos: con una vez basta." />)}
      </div>
      {!codigo.whatsapp && !codigo.telegram && <p className={nota}>Ni WhatsApp ni Telegram están conectados todavía. Conéctalos arriba, en «Grupos de Telegram y WhatsApp», y saca otro código.</p>}
      <div><button type="button" className="ui-button" onClick={cerrar}>Hecho</button></div>
    </div>
  );
}

function ContactoPropio({ bot, ocupado, enviar }: { bot: Estado["bots"][number]; ocupado: boolean; enviar: (path: string, method: string, body?: unknown) => Promise<boolean> }) {
  const [abierto, setAbierto] = useState(false);
  const [token, setToken] = useState("");
  const cp = bot.contactoPropio;
  const estado = cp.estado === "conectado" ? `Conectado como @${cp.usuario}` : cp.activo ? (cp.estado === "error" ? "Hay un problema" : "Conectando…") : cp.tokenPuesto ? "Apagado" : "Sin crear";
  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] text-ink">{bot.name}{bot.principal ? " · principal" : bot.jefe ? " · jefe" : ""}</div>
          <div className={nota}>{estado}</div>
          {fallo(cp.estado === "error" ? cp.error : null)}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {cp.tokenPuesto && <Switch checked={cp.activo} aria-label={`Contacto propio de ${bot.name}`} disabled={ocupado} onClick={() => void enviar("/api/canales", "PATCH", { contactoPropio: { [bot.id]: !cp.activo } })} />}
          <button type="button" className="ui-button" onClick={() => setAbierto(!abierto)}>{cp.tokenPuesto ? "Cambiar" : "Crear"}</button>
        </div>
      </div>
      {abierto && (
        <div className="flex flex-col gap-2 rounded-lg border border-hairline/40 p-3">
          <ol className={`${nota} list-decimal pl-5`}>
            <li>En Telegram abre @BotFather y escribe /newbot.</li>
            <li>Ponle de nombre «{bot.name}» y un usuario que acabe en «bot» (por ejemplo, {bot.name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "")}_openbot_bot).</li>
            <li>Copia el token que te da y pégalo aquí. Si quieres, ponle también su foto con /setuserpic.</li>
          </ol>
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void enviar(`/api/canales/bots/${bot.id}/telegram`, "PUT", { token }).then((ok) => { if (ok) { setToken(""); setAbierto(false); } }); }}>
            <input type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token de BotFather" aria-label={`Token de Telegram de ${bot.name}`} className={`${SETTINGS_INPUT} min-w-0 flex-1`} />
            <button type="submit" className="ui-button" disabled={ocupado || !token.trim()}>Guardar</button>
            {cp.tokenPuesto && <button type="button" className="ui-button" disabled={ocupado} onClick={() => void enviar(`/api/canales/bots/${bot.id}/telegram`, "DELETE")}>Quitar contacto</button>}
          </form>
        </div>
      )}
    </div>
  );
}

export function CanalesSettings() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [codigo, setCodigo] = useState<(Codigo & { nombre: string }) | null>(null);
  const [nueva, setNueva] = useState({ clave: "", nombre: "" });

  const leer = useCallback(async () => {
    try { setEstado(await api<Estado>("/api/canales", { background: true })); } catch { /* el próximo intento */ }
  }, []);
  useEffect(() => { void leer(); }, [leer]);
  // Mientras hay un código a la vista, se mira cada 3 segundos para ver cuándo se vincula.
  useEffect(() => {
    if (!codigo) return;
    const timer = setInterval(() => void leer(), 3000);
    return () => clearInterval(timer);
  }, [codigo, leer]);

  const enviar = async (path: string, method: string, body?: unknown): Promise<boolean> => {
    if (ocupado) return false;
    setOcupado(true);
    setError("");
    try {
      const out = await api<Estado & { estado?: Estado }>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      setEstado(out.estado ?? out);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
      void leer();
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const anadir = async () => {
    const elegida = estado?.personasOpenbot.find((p) => p.clave === nueva.clave);
    const nombre = (nueva.nombre || elegida?.nombre || "").trim();
    if (!nombre) { setError("Elige quién es o escribe un nombre."); return; }
    setOcupado(true);
    setError("");
    try {
      const out = await api<Codigo & { estado: Estado }>("/api/canales/personas", { method: "POST", body: JSON.stringify({ nombre, ...(elegida ? { clave: elegida.clave } : {}) }) });
      setEstado(out.estado);
      setCodigo({ ...out, nombre });
      setNueva({ clave: "", nombre: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo añadir.");
    } finally {
      setOcupado(false);
    }
  };

  const otroCodigo = async (id: string, nombre: string) => {
    try { setCodigo({ ...(await api<Codigo>(`/api/canales/personas/${id}/codigo`, { method: "POST" })), persona: id, nombre }); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo sacar el código."); }
  };

  if (!estado) return null;
  const { conexiones: cx } = estado;
  const ninguno = !estado.bots.some((b) => b.whatsapp || b.telegram);

  return (
    <>
      <SettingsGroup block="openbot-canales" label="Bots en WhatsApp y Telegram"
        description={<div className={`${nota} flex flex-col gap-1`}>
          <p>Habla con tus bots desde el móvil igual que en la app: mismas herramientas, misma memoria y mismo nivel. Te escriben ahí sus respuestas, recordatorios y resultados, y te piden permiso cuando lo necesitan.</p>
          <p>En WhatsApp hay un solo número: hablas con un bot y cambias escribiendo «@Nombre» o «/bots». En Telegram, además, cada bot puede tener su propio contacto.</p>
          <p>Cada bot guarda lo hablado en una conversación «WhatsApp · Nombre» o «Telegram · Nombre», que ves y sigues desde la app.</p>
        </div>}
        footnote={error ? fallo(error) : null}>
        <SettingsRows>
          <SettingRow title="WhatsApp" subtitle={cx.whatsapp.conectado ? `Conectado con +${cx.whatsapp.numero}` : "Sin conectar: se vincula arriba, en «Grupos de Telegram y WhatsApp»"}>
            <span className={`text-[12px] ${cx.whatsapp.conectado ? "text-success" : "text-ink-tertiary"}`}>{cx.whatsapp.conectado ? "Listo" : "—"}</span>
          </SettingRow>
          <SettingRow title="Telegram (contacto general)" subtitle={cx.telegram.conectado ? `Conectado como @${cx.telegram.usuario}` : "Sin conectar: se pone el token arriba, en «Grupos de Telegram y WhatsApp»"}>
            <span className={`text-[12px] ${cx.telegram.conectado ? "text-success" : "text-ink-tertiary"}`}>{cx.telegram.conectado ? "Listo" : "—"}</span>
          </SettingRow>
        </SettingsRows>
      </SettingsGroup>

      <SettingsGroup block="openbot-canales-bots" label="Qué bots puedes usar desde el móvil"
        description={<p className={nota}>{ninguno ? "Elige al menos un bot. " : ""}El primero que hable contigo será el principal, si está; luego cambias cuando quieras.</p>}>
        <SettingsRows>
          {estado.bots.map((b) => (
            <SettingRow key={b.id} title={b.name} tag={b.principal ? "Principal" : b.jefe ? "Jefe" : undefined}>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-[12px] text-ink-secondary">WhatsApp
                  <Switch checked={b.whatsapp} aria-label={`${b.name} en WhatsApp`} disabled={ocupado} onClick={() => void enviar("/api/canales", "PATCH", { bots: { [b.id]: { whatsapp: !b.whatsapp } } })} />
                </label>
                <label className="flex items-center gap-2 text-[12px] text-ink-secondary">Telegram
                  <Switch checked={b.telegram} aria-label={`${b.name} en Telegram`} disabled={ocupado} onClick={() => void enviar("/api/canales", "PATCH", { bots: { [b.id]: { telegram: !b.telegram } } })} />
                </label>
              </div>
            </SettingRow>
          ))}
        </SettingsRows>
      </SettingsGroup>

      <SettingsGroup block="openbot-canales-personas" label="Quién puede hablar con los bots"
        description={<p className={nota}>Solo contestan a las personas de esta lista. A cualquier otro número o cuenta no se le responde nada. Cada persona se vincula una vez mandando un código desde su móvil.</p>}>
        <SettingsRows>
          {estado.personas.map((p) => (
            <div key={p.id} className="flex flex-col gap-2 px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-ink">{p.nombre}</div>
                  <div className={nota}>
                    WhatsApp: {p.whatsapp ?? "sin vincular"} · Telegram: {p.telegram ? "vinculado" : "sin vincular"}
                    {!p.clave && estado.personasOpenbot.length > 1 ? " · sus mensajes salen como del dueño" : ""}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <button type="button" className="ui-button" disabled={ocupado} onClick={() => void otroCodigo(p.id, p.nombre)}>{p.whatsapp || p.telegram ? "Vincular otro móvil" : "Sacar código"}</button>
                  <button type="button" className="ui-button" disabled={ocupado} onClick={() => { if (window.confirm(`¿Quitar a ${p.nombre}? Dejará de poder hablar con los bots desde el móvil. Sus conversaciones siguen en la app.`)) void enviar(`/api/canales/personas/${p.id}`, "DELETE"); }}>Quitar</button>
                </div>
              </div>
              {codigo?.persona === p.id ? <PanelCodigo codigo={codigo} nombre={p.nombre} cerrar={() => setCodigo(null)} /> : null}
              <div className="flex flex-col gap-1 rounded-lg bg-app/60 p-2">
                <div className="text-[12px] font-medium text-ink-secondary">Avisos que le llegan al móvil (además de las respuestas de sus conversaciones)</div>
                {AVISOS.map((a) => (
                  <SettingRow key={a.id} title={a.titulo} subtitle={a.linea}>
                    <Switch checked={p.avisos[a.id]} aria-label={`${a.titulo} para ${p.nombre}`} disabled={ocupado} onClick={() => void enviar("/api/canales", "PATCH", { persona: { id: p.id, avisos: { [a.id]: !p.avisos[a.id] } } })} />
                  </SettingRow>
                ))}
                {p.whatsapp && p.telegram && (
                  <SettingRow title="Los avisos llegan por">
                    <select className={SELECT} value={p.avisosPor ?? "whatsapp"} disabled={ocupado} onChange={(e) => void enviar("/api/canales", "PATCH", { persona: { id: p.id, avisosPor: e.target.value } })} aria-label="Por dónde llegan los avisos">
                      <option value="whatsapp">WhatsApp</option>
                      <option value="telegram">Telegram</option>
                    </select>
                  </SettingRow>
                )}
              </div>
            </div>
          ))}
          <div className="flex flex-col gap-2 px-3 py-3">
            <div className="text-[13px] font-medium text-ink">Añadir a alguien</div>
            <div className="flex flex-wrap items-center gap-2">
              {estado.personasOpenbot.length > 0 && (
                <select className={SELECT} value={nueva.clave} onChange={(e) => setNueva({ clave: e.target.value, nombre: "" })} aria-label="Quién es en OpenBot">
                  <option value="">Elige quién es…</option>
                  {estado.personasOpenbot.map((o) => <option key={o.clave} value={o.clave}>{o.nombre}</option>)}
                </select>
              )}
              {!nueva.clave && <input value={nueva.nombre} onChange={(e) => setNueva({ clave: "", nombre: e.target.value })} placeholder="Nombre" maxLength={60} aria-label="Nombre" className={`${SETTINGS_INPUT} w-48`} />}
              <button type="button" className="ui-button ui-button-primary" disabled={ocupado} onClick={() => void anadir()}>Añadir y sacar código</button>
            </div>
            {codigo && !codigo.persona && <PanelCodigo codigo={codigo} nombre={codigo.nombre} cerrar={() => setCodigo(null)} />}
          </div>
        </SettingsRows>
      </SettingsGroup>

      <SettingsGroup block="openbot-canales-propios" label="Contacto propio de cada bot en Telegram (opcional)"
        description={<p className={nota}>Cada bot puede ser un contacto más en tu Telegram, con su nombre y su foto: ahí solo habla ese bot. Se crea gratis en @BotFather; no hace falta para nada más.</p>}>
        <SettingsRows>
          {estado.bots.map((b) => <ContactoPropio key={b.id} bot={b} ocupado={ocupado} enviar={enviar} />)}
        </SettingsRows>
      </SettingsGroup>
    </>
  );
}
