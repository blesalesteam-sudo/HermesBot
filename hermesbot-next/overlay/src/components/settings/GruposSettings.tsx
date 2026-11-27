// OpenBot: Ajustes > Funciones > Grupos de Telegram y WhatsApp (server/grupos, server/routes/grupos.ts).
// Textos en español directamente: esta parte es solo de OpenBot.
import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "@/state/api";
import { SETTINGS_INPUT, SettingRow, SettingsGroup, SettingsRows, Switch } from "../SettingsPrimitives";

type Modo = "apagado" | "silencioso" | "bajo-demanda";
type Conexion = "apagado" | "conectando" | "esperando-qr" | "conectado" | "error";
interface EstadoConector { estado: Conexion; cuenta?: string; error?: string; qr?: string; activo: boolean }
interface Estado {
  telegram: EstadoConector & { tokenPuesto: boolean; tokenDeEntorno: boolean };
  whatsapp: EstadoConector & { vinculado: boolean; disponible: boolean };
  gruposNuevos: "apagado" | "silencioso";
  bots: "todos" | string[];
  botQueResponde?: string;
  todosLosBots: Array<{ id: string; name: string }>;
  grupos: Array<{ clave: string; plataforma: "telegram" | "whatsapp"; nombre: string; modo: Modo; mensajes: number; ultimoMensaje?: number }>;
}

const MODOS: Array<{ id: Modo; texto: string }> = [
  { id: "apagado", texto: "Apagado: no lee nada" },
  { id: "silencioso", texto: "Silencioso: lee y guarda, nunca escribe" },
  { id: "bajo-demanda", texto: "Bajo demanda: contesta si lo mencionan" },
];

const ESTADO: Record<Conexion, string> = { apagado: "Apagado", conectando: "Conectando…", "esperando-qr": "Esperando que escanees el código", conectado: "Conectado", error: "Hay un problema" };

const SELECT = `${SETTINGS_INPUT} w-auto max-w-full pr-6`;
const nota = "text-[12px] leading-5 text-ink-secondary";
const fallo = (texto?: string) => (texto ? <p role="alert" className="text-[12px] text-danger">{texto}</p> : null);

function cuando(ms?: number): string {
  if (!ms) return "sin mensajes guardados";
  return `último ${new Date(ms).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
}

export function GruposSettings() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [token, setToken] = useState("");

  const leer = useCallback(async () => {
    try {
      setEstado(await api<Estado>("/api/grupos", { background: true }));
    } catch {
      /* el próximo intento lo vuelve a leer */
    }
  }, []);

  useEffect(() => { void leer(); }, [leer]);
  // Mientras se conecta o espera el QR, se mira cada dos segundos.
  const vigilando = estado && [estado.telegram.estado, estado.whatsapp.estado].some((e) => e === "conectando" || e === "esperando-qr");
  useEffect(() => {
    if (!vigilando) return;
    const timer = setInterval(() => void leer(), 2000);
    return () => clearInterval(timer);
  }, [vigilando, leer]);

  const enviar = async (path: string, method: string, body?: unknown) => {
    if (ocupado) return;
    setOcupado(true);
    setError("");
    try {
      setEstado(await api<Estado>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
      void leer();
      return false;
    } finally {
      setOcupado(false);
    }
  };
  const cambiar = (body: Record<string, unknown>) => enviar("/api/grupos", "PATCH", body);

  if (!estado) return null;
  const { telegram: tg, whatsapp: wa } = estado;
  const elegidos = estado.bots === "todos" ? estado.todosLosBots.map((b) => b.id) : estado.bots;

  return (
    <>
      <SettingsGroup block="openbot-grupos" label="Grupos de Telegram y WhatsApp"
        description={<p className={nota}>El bot está en tus grupos, lee lo que se habla y lo guarda en la memoria de los bots para resúmenes, tareas, decisiones, fechas y enlaces. No escribe nunca en un grupo salvo que lo pongas en «bajo demanda». Lo que se dice en un grupo es información, no órdenes: nadie del grupo puede mandar a tus bots.</p>}
        footnote={error ? fallo(error) : null}>
        <SettingsRows>
          <SettingRow title="Telegram"
            subtitle={<span>{tg.estado === "conectado" ? `Conectado como ${tg.cuenta ?? "el bot"}` : ESTADO[tg.estado]}{!tg.tokenPuesto ? " · falta el token" : ""}</span>}
            message={fallo(tg.estado === "error" ? tg.error : undefined)}>
            <Switch checked={tg.activo} aria-label="Leer grupos de Telegram" disabled={ocupado || (!tg.tokenPuesto && !tg.activo)} onClick={() => void cambiar({ telegram: { activo: !tg.activo } })}
              className="disabled:cursor-not-allowed disabled:opacity-50" />
          </SettingRow>
          <div className="flex flex-col gap-2 px-3 py-3">
            <ol className={`${nota} list-decimal pl-5`}>
              <li>En Telegram, habla con @BotFather, crea un bot nuevo solo para OpenBot y copia su token.</li>
              <li>En BotFather: Bot Settings → Group Privacy → Turn off. Si no, el bot solo ve lo que va dirigido a él. También vale hacerlo administrador del grupo.</li>
              <li>Añade el bot a tus grupos (si ya estaba, sácalo y vuelve a meterlo). Telegram es la vía oficial: no hay riesgo de bloqueo.</li>
            </ol>
            {tg.tokenDeEntorno ? <p className={nota}>El token viene de la variable OPENBOT_TELEGRAM_TOKEN del servidor.</p> : (
              <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void enviar("/api/grupos/telegram/token", "PUT", { token }).then((ok) => { if (ok) setToken(""); }); }}>
                <input type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)}
                  placeholder={tg.tokenPuesto ? "Token guardado (escribe otro para cambiarlo)" : "Pega aquí el token de BotFather"} aria-label="Token del bot de Telegram" className={`${SETTINGS_INPUT} min-w-0 flex-1`} />
                <button type="submit" className="ui-button" disabled={ocupado || !token.trim()}>Guardar token</button>
                {tg.tokenPuesto && <button type="button" className="ui-button" disabled={ocupado} onClick={() => void enviar("/api/grupos/telegram/token", "DELETE")}>Quitar</button>}
              </form>
            )}
          </div>

          <SettingRow title="WhatsApp"
            subtitle={<span>{wa.estado === "conectado" ? `Conectado con ${wa.cuenta ?? "el número"}` : wa.vinculado ? `Vinculado · ${ESTADO[wa.estado]}` : wa.estado === "apagado" ? "Sin vincular" : ESTADO[wa.estado]}</span>}
            message={fallo(wa.estado === "error" ? wa.error : undefined)}>
            <Switch checked={wa.activo} aria-label="Leer grupos de WhatsApp" disabled={ocupado || !wa.disponible || (!wa.vinculado && !wa.activo)} onClick={() => void cambiar({ whatsapp: { activo: !wa.activo } })}
              className="disabled:cursor-not-allowed disabled:opacity-50" />
          </SettingRow>
          <div className="flex flex-col gap-2 px-3 py-3">
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-[12px] leading-5 text-ink">
              Atención: WhatsApp se conecta como WhatsApp Web, que es una vía no oficial. WhatsApp puede restringir o bloquear el número. Usa un número solo para el bot, nunca el tuyo ni el de la empresa.
            </p>
            {!wa.disponible ? <p className={nota}>Este servidor no tiene instalada la librería de WhatsApp.</p> : wa.estado === "esperando-qr" && wa.qr ? (
              <div className="flex flex-col items-start gap-2">
                <p className={nota}>En el teléfono del bot: WhatsApp → Dispositivos vinculados → Vincular un dispositivo, y escanea este código.</p>
                <div className="rounded-lg bg-white p-3"><QRCodeSVG value={wa.qr} size={208} /></div>
                <button type="button" className="ui-button" disabled={ocupado} onClick={() => void cambiar({ whatsapp: { activo: false } })}>Cancelar</button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {!wa.vinculado && <button type="button" className="ui-button" disabled={ocupado} onClick={() => void enviar("/api/grupos/whatsapp/vincular", "POST")}>Vincular con código QR</button>}
                {wa.vinculado && <button type="button" className="ui-button" disabled={ocupado} onClick={() => { if (window.confirm("¿Desvincular WhatsApp? Se cierra la sesión y habrá que volver a escanear el código.")) void enviar("/api/grupos/whatsapp/desvincular", "POST"); }}>Desvincular</button>}
              </div>
            )}
          </div>
        </SettingsRows>
      </SettingsGroup>

      <SettingsGroup block="openbot-grupos-lista" label="Qué hace en cada grupo"
        description={<p className={nota}>Los grupos aparecen aquí cuando el bot entra o alguien escribe. «Bajo demanda» contesta en el grupo solo a quien menciona al bot o responde a un mensaje suyo, con pausas y un máximo de respuestas al día.</p>}>
        <SettingsRows>
          <SettingRow title="Grupos nuevos" subtitle="Qué hacer cuando el bot entra en un grupo que aún no está en la lista">
            <select className={SELECT} value={estado.gruposNuevos} disabled={ocupado} onChange={(e) => void cambiar({ gruposNuevos: e.target.value })} aria-label="Grupos nuevos">
              <option value="apagado">No leer hasta que lo active</option>
              <option value="silencioso">Leer en silencio desde el principio</option>
            </select>
          </SettingRow>
          {estado.grupos.length === 0 && <p className={`${nota} px-3 py-3`}>Todavía no hay grupos. Conecta Telegram o WhatsApp y añade el bot a un grupo.</p>}
          {estado.grupos.map((g) => (
            <SettingRow key={g.clave} title={g.nombre} subtitle={`${g.plataforma === "telegram" ? "Telegram" : "WhatsApp"} · ${g.mensajes} mensajes guardados · ${cuando(g.ultimoMensaje)}`}>
              <select className={SELECT} value={g.modo} disabled={ocupado} onChange={(e) => void cambiar({ grupos: { [g.clave]: e.target.value } })} aria-label={`Modo de ${g.nombre}`}>
                {MODOS.map((m) => <option key={m.id} value={m.id}>{m.texto}</option>)}
              </select>
            </SettingRow>
          ))}
        </SettingsRows>
      </SettingsGroup>

      <SettingsGroup block="openbot-grupos-bots" label="Qué bots lo usan"
        description={<p className={nota}>Cada bot elegido tiene en su memoria un tema por grupo con lo de las últimas semanas; el registro completo se guarda aparte en el servidor.</p>}>
        <SettingsRows>
          <SettingRow title="Todos los bots" subtitle="También los que crees más adelante">
            <Switch checked={estado.bots === "todos"} aria-label="Todos los bots" disabled={ocupado} onClick={() => void cambiar({ bots: estado.bots === "todos" ? elegidos : "todos" })} />
          </SettingRow>
          {estado.bots !== "todos" && estado.todosLosBots.map((b) => (
            <SettingRow key={b.id} title={b.name}>
              <Switch checked={elegidos.includes(b.id)} aria-label={`Que ${b.name} lea los grupos`} disabled={ocupado}
                onClick={() => void cambiar({ bots: elegidos.includes(b.id) ? elegidos.filter((id) => id !== b.id) : [...elegidos, b.id] })} />
            </SettingRow>
          ))}
          <SettingRow title="Quién responde bajo demanda" subtitle="Escribe la respuesta sin herramientas y sin su memoria privada: solo con lo que se habló en el grupo">
            <select className={SELECT} value={estado.botQueResponde ?? ""} disabled={ocupado} onChange={(e) => void cambiar({ botQueResponde: e.target.value })} aria-label="Bot que responde">
              <option value="">El primero de los elegidos</option>
              {estado.todosLosBots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </SettingRow>
        </SettingsRows>
      </SettingsGroup>
    </>
  );
}
