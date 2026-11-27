// OpenBot: Ajustes › Avisos. Un interruptor para recibir avisos en este aparato (aunque OpenBot esté cerrada), un botón
// para probarlo y, debajo, qué bots pueden avisarte. Ver openbot-push.ts.
import { useEffect, useState } from "react";
import { BellRing, Check, Loader2, Share, SquarePlus } from "lucide-react";
import { BotAvatar } from "@/components/Avatar";
import { SettingRow, Switch } from "@/components/SettingsPrimitives";
import { useStore } from "@/state/store";
import { activar, desactivar, probar, pushSupport, readStatus, silenciarBot, usePushOn } from "./openbot-push";

const isMac = () => /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints <= 1;

function blockedHelp(): string {
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))
    return "Los has bloqueado. Ábrelos en Ajustes del iPhone › Notificaciones › OpenBot.";
  return `Los has bloqueado en este navegador. Pulsa el candado junto a la dirección, permite las notificaciones y vuelve aquí.${isMac() ? " En el Mac, mira también Ajustes del Sistema › Notificaciones." : ""}`;
}

export function OpenbotAvisos() {
  const support = pushSupport();
  const on = usePushOn();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(() => typeof Notification !== "undefined" && Notification.permission === "denied");
  const [tested, setTested] = useState<"idle" | "sending" | "sent">("idle");
  const [muted, setMuted] = useState<string[]>([]);
  const { state } = useStore();
  const bots = state.bots.filter((bot) => !(bot as { hidden?: boolean }).hidden);
  const main = bots.find((bot) => (bot as { defaultBot?: unknown }).defaultBot) ?? bots[0];

  useEffect(() => {
    void readStatus().then((status) => { if (status) setMuted(status.muted); });
  }, [on]);

  const toggle = async () => {
    setError(null);
    setBusy(true);
    try {
      if (on) await desactivar();
      else {
        const problem = await activar();
        if (problem === "bloqueado") setBlocked(true);
        else if (problem) setError(problem);
        else setBlocked(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    if (!main) return;
    setError(null);
    setTested("sending");
    const problem = await probar(main.id);
    if (problem) { setError(problem); setTested("idle"); return; }
    setTested("sent");
    window.setTimeout(() => setTested("idle"), 6000);
  };

  const subtitle = support === "ios-install"
    ? "En el iPhone, los avisos llegan cuando OpenBot está en tu pantalla de inicio."
    : support === "unsupported"
      ? "Este navegador no puede recibir avisos. Prueba con Safari, Chrome o Edge actualizados."
      : blocked ? blockedHelp()
        : on ? "Te aviso cuando un bot termine, te necesite o te escriba por su cuenta, aunque OpenBot esté cerrada."
          : "Actívalos para enterarte cuando un bot termine o te necesite, aunque no tengas OpenBot delante.";

  return (
    <>
      <SettingRow title="Avisos en este aparato" subtitle={subtitle} message={error ? <span className="text-[color:var(--color-danger,#c0392b)]">{error}</span> : undefined}>
        {support === "ok" && (busy
          ? <Loader2 size={18} className="animate-spin text-ink-secondary" aria-label="Un momento" />
          : <Switch checked={on && !blocked} disabled={blocked} aria-label="Avisos en este aparato" onClick={() => void toggle()} />)}
      </SettingRow>

      {support === "ios-install" && (
        <div data-openbot-avisos-pasos="" className="flex flex-col gap-2.5 px-4 pb-4 text-[13px] leading-[18px] text-ink-secondary">
          <Paso n={1} icon={<Share size={15} aria-hidden="true" />}>En Safari, toca <b className="font-medium text-ink">Compartir</b> (abajo).</Paso>
          <Paso n={2} icon={<SquarePlus size={15} aria-hidden="true" />}>Elige <b className="font-medium text-ink">Añadir a pantalla de inicio</b>.</Paso>
          <Paso n={3} icon={<BellRing size={15} aria-hidden="true" />}>Abre OpenBot desde su icono y vuelve aquí para activar los avisos.</Paso>
        </div>
      )}

      {support === "ok" && on && !blocked && main && (
        <SettingRow title="Probar" subtitle={tested === "sent" ? "Enviado. Debería aparecer en unos segundos." : `Te llegará un aviso de ${main.name}.`}>
          <button type="button" className="ui-button" data-openbot-avisos-probar="" disabled={tested === "sending"} onClick={() => void test()}>
            {tested === "sending" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : tested === "sent" ? <Check size={14} aria-hidden="true" /> : null}
            <span className={tested === "idle" ? "" : "ms-1.5"}>{tested === "sent" ? "Enviado" : "Probar"}</span>
          </button>
        </SettingRow>
      )}

      {support === "ok" && on && !blocked && bots.length > 1 && (
        <div data-openbot-avisos-bots="">
          <div className="px-4 pt-3 pb-1 text-[12px] font-medium uppercase tracking-wide text-ink-secondary">Qué bots te avisan</div>
          {bots.map((bot) => {
            const quiet = muted.includes(bot.id);
            return (
              <SettingRow key={bot.id} title={bot.name} subtitle={quiet ? "Silenciado" : undefined}
                leading={<BotAvatar bot={bot} size={28} label="" animated={false} />}>
                <Switch checked={!quiet} aria-label={`Avisos de ${bot.name}`} onClick={() => {
                  const next = !quiet;
                  setMuted((list) => (next ? [...list, bot.id] : list.filter((id) => id !== bot.id)));
                  void silenciarBot(bot.id, next).then((list) => { if (list) setMuted(list); });
                }} />
              </SettingRow>
            );
          })}
        </div>
      )}
    </>
  );
}

function Paso({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-[12px] font-medium text-ink">{n}</span>
      <span className="flex min-w-0 items-center gap-1.5">{icon}<span>{children}</span></span>
    </div>
  );
}
