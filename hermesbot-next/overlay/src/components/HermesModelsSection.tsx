// OpenBot: Ajustes > IA > Modelos de Hermes. Lo mismo que `hermes model` en la app de Hermes, en una pantalla:
// el modelo general, las cuentas y claves de cada proveedor y qué modelo usa cada bot (server/openbot-hermes-models.ts).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ExternalLink, KeyRound, Loader2, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { call } from "./openbot/people-api";
import { obField, obPrimary, obQuiet } from "./openbot/OpenbotProfile";

interface Provider { id: string; name: string; kind: "oauth" | "key"; hint?: string; url?: string; connected: boolean }
interface Model { id: string; label: string }
interface Bot { id: string; name: string; color?: string; hermes: boolean; model: string | null }
interface State { current: { provider: string; model: string }; providers: Provider[]; models: Model[]; bots: Bot[] }

const GENERAL = "hermes-default";
const providerOf = (id: string) => id.slice(0, Math.max(0, id.indexOf(":")));
const modelOf = (id: string) => id.slice(id.indexOf(":") + 1);
/** Hermes names a model `<proveedor>:<modelo>` or with its own label; the provider is already the group's title. */
const nameOf = (model: Model) => {
  const provider = providerOf(model.id);
  return provider && model.label.startsWith(`${provider}:`) ? model.label.slice(provider.length + 1) : model.label || modelOf(model.id);
};

function Card({ title, line, children, action }: { title: string; line?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-[22px] bg-inset/60 p-4 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
          {line && <p className="mt-0.5 text-[13px] leading-snug text-ink-secondary">{line}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function ModelPicker({ models, providers, value, onPick, onClose, general }: {
  models: Model[]; providers: Provider[]; value: string; onPick: (id: string) => void; onClose: () => void; general?: string;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  const names = useMemo(() => new Map(providers.map((p) => [p.id, p.name])), [providers]);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = new Map<string, Model[]>();
    for (const model of models) {
      if (q && !`${model.label} ${model.id}`.toLowerCase().includes(q)) continue;
      const key = providerOf(model.id) || "otros";
      out.set(key, [...(out.get(key) ?? []), model]);
    }
    return [...out.entries()];
  }, [models, query]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-[26px] bg-app shadow-2xl sm:rounded-[26px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 p-4 pb-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-tertiary" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar modelo" className={`${obField} pl-10`} />
          </div>
          <button type="button" onClick={onClose} className="grid size-10 place-items-center rounded-full hover:bg-inset" aria-label="Cerrar"><X className="size-5" /></button>
        </div>
        <div className="overflow-y-auto px-2 pb-4">
          {general && (
            <button type="button" onClick={() => onPick(GENERAL)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left hover:bg-inset">
              <Sparkles className="size-4 text-accent" />
              <span className="flex-1"><span className="block text-[15px] text-ink">Modelo general de Hermes</span><span className="block text-[12px] text-ink-secondary">{general}</span></span>
              {value === GENERAL && <Check className="size-4 text-accent" />}
            </button>
          )}
          {groups.map(([provider, list]) => (
            <div key={provider} className="mt-2">
              <div className="px-3 pb-1 pt-2 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{names.get(provider) ?? provider}</div>
              {list.map((model) => (
                <button key={model.id} type="button" onClick={() => onPick(model.id)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-inset">
                  <span className="flex-1 truncate text-[15px] text-ink">{nameOf(model)}</span>
                  {value === model.id && <Check className="size-4 text-accent" />}
                </button>
              ))}
            </div>
          ))}
          {!groups.length && <p className="px-3 py-6 text-center text-[14px] text-ink-secondary">{models.length ? "Ningún modelo coincide." : "Conecta un proveedor para ver sus modelos."}</p>}
        </div>
      </div>
    </div>
  );
}

function ProviderTile({ provider, onChanged }: { provider: Provider; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (remove = false) => {
    setBusy(true); setError(null);
    const done = provider.kind === "key"
      ? await call("/api/openbot/hermes/key", "POST", remove ? { provider: provider.id, remove: true } : { provider: provider.id, key })
      : await call("/api/openbot/hermes/logout", "POST", { provider: provider.id });
    setBusy(false);
    if (!done.ok) return setError(done.error);
    setKey(""); setOpen(false); onChanged();
  };
  return (
    <div className={`rounded-2xl border bg-app transition-colors ${open ? "border-hairline" : "border-transparent"}`}>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
        <span className={`size-2.5 shrink-0 rounded-full ${provider.connected ? "bg-emerald-500" : "bg-ink-tertiary/40"}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-ink">{provider.name}</span>
          <span className="block truncate text-[12px] text-ink-secondary">{provider.connected ? "Conectado" : provider.hint ?? (provider.kind === "key" ? "Con tu clave" : "Con tu cuenta")}</span>
        </span>
        <ChevronDown className={`size-4 text-ink-tertiary transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 px-3.5 pb-3.5">
          {provider.kind === "key" ? (
            <>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-tertiary" />
                <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)}
                  placeholder={provider.connected ? "Pegar una clave nueva" : "Pega tu clave"} className={`${obField} pl-10`} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy || key.trim().length < 8} onClick={() => void save()} className={obPrimary}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}Guardar
                </button>
                {provider.connected && <button type="button" disabled={busy} onClick={() => void save(true)} className={obQuiet}>Quitar clave</button>}
                {provider.url && <a href={provider.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-[13px] text-accent">Conseguir clave <ExternalLink className="size-3.5" /></a>}
              </div>
              <p className="text-[12px] text-ink-tertiary">La clave se guarda solo en tu servidor, en la configuración de Hermes.</p>
            </>
          ) : provider.connected ? (
            <button type="button" disabled={busy} onClick={() => void save()} className={`${obQuiet} self-start`}>Desconectar</button>
          ) : (
            <p className="text-[13px] text-ink-secondary">
              {provider.id === "openai-codex" ? "Pulsa «Conectar ChatGPT» más abajo: te dará un código para entrar con tu cuenta." : "Se conecta con tu cuenta desde la app de Hermes (hermes model)."}
            </p>
          )}
          {error && <p className="text-[13px] text-red-500">{error}</p>}
        </div>
      )}
    </div>
  );
}

export function HermesModelsSection() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<{ bot?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async (fresh = false) => {
    const got = await call<State>(`/api/openbot/hermes${fresh ? "?fresh=1" : ""}`);
    if (got.ok) { setState(got.data); setError(null); } else setError(got.error);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const flash = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(null), 2500); };
  const pick = async (id: string) => {
    const target = picking;
    setPicking(null);
    if (!target) return;
    setBusy(true);
    const done = target.bot
      ? await call("/api/openbot/hermes/bot", "POST", { botId: target.bot, model: id })
      : await call("/api/openbot/hermes/default", "POST", { model: id });
    setBusy(false);
    if (!done.ok) return setError(done.error);
    flash(target.bot ? "Modelo del bot cambiado" : "Modelo general cambiado");
    void load();
  };
  const allToHermes = async () => {
    setBusy(true);
    const done = await call<{ moved: number }>("/api/openbot/hermes/all", "POST", {});
    setBusy(false);
    if (!done.ok) return setError(done.error);
    flash(done.data.moved ? `${done.data.moved} bots usan ahora Hermes` : "Todos los bots ya usaban Hermes");
    void load();
  };

  if (!state) {
    return <div className="flex items-center gap-2 rounded-[22px] bg-inset/60 p-5 text-[14px] text-ink-secondary">
      {error ? error : <><Loader2 className="size-4 animate-spin" /> Leyendo los modelos de Hermes…</>}
    </div>;
  }

  const providerName = state.providers.find((p) => p.id === state.current.provider)?.name ?? state.current.provider;
  const connected = state.providers.filter((p) => p.connected);
  const others = state.providers.filter((p) => !p.connected);
  const shownOthers = showAll ? others : others.slice(0, 4);
  const label = (id: string | null) => {
    if (!id || id === GENERAL) return "General";
    const found = state.models.find((m) => m.id === id);
    return found ? nameOf(found) : modelOf(id);
  };
  const notHermes = state.bots.filter((bot) => !bot.hermes).length;

  return (
    <div className="flex flex-col gap-4" data-settings-block="hermes-models">
      <Card title="Modelo de Hermes" line="Lo usan todos tus bots, salvo los que tengan uno propio."
        action={<button type="button" onClick={() => void load(true)} className="grid size-9 place-items-center rounded-full text-ink-secondary hover:bg-inset" aria-label="Actualizar"><RefreshCw className="size-4" /></button>}>
        <button type="button" disabled={busy} onClick={() => setPicking({})}
          className="flex w-full items-center gap-3 rounded-2xl bg-app px-4 py-3.5 text-left shadow-sm transition-transform active:scale-[0.99]">
          <span className="grid size-10 place-items-center rounded-full bg-accent/10"><Sparkles className="size-5 text-accent" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-semibold text-ink">{state.current.model || "Sin modelo"}</span>
            <span className="block truncate text-[13px] text-ink-secondary">{providerName || "Elige un proveedor"}</span>
          </span>
          {busy ? <Loader2 className="size-4 animate-spin text-ink-tertiary" /> : <ChevronDown className="size-4 text-ink-tertiary" />}
        </button>
        {notice && <p className="mt-2 flex items-center gap-1.5 text-[13px] text-emerald-600"><Check className="size-4" />{notice}</p>}
        {error && <p className="mt-2 text-[13px] text-red-500">{error}</p>}
      </Card>

      <Card title="Proveedores" line="Conecta tus cuentas o pega tus claves. Sus modelos aparecen arriba.">
        <div className="flex flex-col gap-1.5">
          {connected.map((p) => <ProviderTile key={p.id} provider={p} onChanged={() => void load(true)} />)}
          {connected.length > 0 && others.length > 0 && <div className="px-1 pt-2 text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">Añadir otro</div>}
          {shownOthers.map((p) => <ProviderTile key={p.id} provider={p} onChanged={() => void load(true)} />)}
          {others.length > 4 && (
            <button type="button" onClick={() => setShowAll(!showAll)} className="mt-1 self-start px-1 text-[13px] font-medium text-accent">
              {showAll ? "Ver menos" : `Ver ${others.length - 4} más`}
            </button>
          )}
        </div>
      </Card>

      <Card title="Modelo de cada bot" line="«General» sigue el modelo de Hermes; o elige uno solo para ese bot."
        action={notHermes > 0 ? <button type="button" disabled={busy} onClick={() => void allToHermes()} className={`${obQuiet} h-9 shrink-0 text-[13px]`}>Todos con Hermes</button> : undefined}>
        <div className="flex flex-col gap-1">
          {state.bots.map((bot) => (
            <button key={bot.id} type="button" disabled={busy} onClick={() => setPicking({ bot: bot.id })}
              className="flex items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-app">
              <span className="grid size-8 place-items-center rounded-full bg-app text-[13px] font-semibold text-ink shadow-sm">{bot.name.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{bot.name}</span>
              <span className={`max-w-[45%] truncate rounded-full px-2.5 py-1 text-[12px] ${bot.hermes ? "bg-app text-ink-secondary" : "bg-amber-500/15 text-amber-700"}`}>
                {bot.hermes ? label(bot.model) : "Sin Hermes"}
              </span>
            </button>
          ))}
        </div>
      </Card>

      {picking && (
        <ModelPicker models={state.models} providers={state.providers} onClose={() => setPicking(null)} onPick={(id) => void pick(id)}
          value={picking.bot ? (state.bots.find((b) => b.id === picking.bot)?.model ?? "") : `${state.current.provider}:${state.current.model}`}
          general={picking.bot ? `${state.current.model}${providerName ? ` · ${providerName}` : ""}` : undefined} />
      )}
    </div>
  );
}
