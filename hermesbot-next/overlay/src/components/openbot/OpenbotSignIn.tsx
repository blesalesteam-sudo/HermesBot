// OpenBot: la pantalla de entrar (usuario y contraseña) y la de aceptar una invitación (/pair?invitacion=…), planas y
// centradas como Grok Bot. El código de emparejamiento sigue ahí por si alguien se queda fuera, pero escondido: solo sale
// con un enlace que ya trae el código o abriendo /pair#codigo.
import { useEffect, useState, type ReactNode } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { defaultDeviceLabel, signInWithPassword } from "@/lib/session";
import { pairedDestination } from "@/lib/phone-pairing";
import { serverFetch } from "@/lib/relay-server";
import { call } from "./people-api";

const field = "h-12 w-full rounded-xl border border-transparent bg-inset px-4 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-tertiary focus:border-hairline focus:bg-app";
const primary = "inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-[15px] font-semibold text-accent-ink transition-opacity disabled:opacity-40";

/** Whether this page should show the pairing code instead (a link with a code, an invited email, or #codigo). */
export function wantsPairingCode(hasCode: boolean, hasEmail: boolean): boolean {
  return hasCode || hasEmail || /^#codigo$/i.test(location.hash);
}

export function invitationToken(): string | null {
  const token = new URLSearchParams(location.search).get("invitacion");
  return token && /^[\w-]{16,64}$/.test(token) ? token : null;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main data-openbot-signin className="flex min-h-[100dvh] items-center justify-center bg-app px-4 py-10 text-ink">
      <div className="flex w-full max-w-[360px] flex-col gap-3">
        <img src="/openbot-logo.svg" alt="" width={64} height={64} draggable={false} className="mx-auto mb-2 size-16" />
        {children}
      </div>
    </main>
  );
}

function PasswordField({ id, value, onChange, placeholder, autoComplete }: { id: string; value: string; onChange(value: string): void; placeholder: string; autoComplete: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input id={id} aria-label={placeholder} placeholder={placeholder} type={shown ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} className={`${field} pr-12`} />
      <button type="button" onClick={() => setShown(!shown)} aria-label={shown ? "Ocultar contraseña" : "Ver contraseña"} className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-secondary hover:text-ink">
        {shown ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

function Problem({ text }: { text: string | null }) {
  return text ? <p role="alert" className="rounded-xl bg-inset px-4 py-3 text-[13px] text-danger">{text}</p> : null;
}

export function OpenbotSignIn({ name, reason }: { name: string; reason?: string | null }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signInWithPassword({ username: username.trim().toLowerCase(), password, label: defaultDeviceLabel() });
    if (result.ok) {
      location.replace(pairedDestination(location.search));
      return;
    }
    setBusy(false);
    setError(result.error);
  }

  return (
    <Shell>
      <h1 className="text-center text-[24px] font-bold tracking-[-0.01em]">Entrar en {name}</h1>
      <p className="-mt-1 mb-3 text-center text-[14px] text-ink-secondary">Con tu usuario y tu contraseña</p>
      {reason ? <p className="text-center text-[13px] text-ink-secondary">{reason}</p> : null}
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input id="openbot-username" aria-label="Usuario" placeholder="Usuario" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} className={field} autoFocus />
        <PasswordField id="openbot-password" value={password} onChange={setPassword} placeholder="Contraseña" autoComplete="current-password" />
        <Problem text={error} />
        <button type="submit" disabled={busy || !username.trim() || !password} className={`${primary} mt-1`}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : null} {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
      <p className="mt-2 text-center text-[13px] text-ink-secondary">¿No tienes cuenta? Pide una invitación a quien te dio este enlace.</p>
    </Shell>
  );
}

export function OpenbotInvitation({ token, name: placeName }: { token: string; name: string }) {
  const [invite, setInvite] = useState<{ byName: string; place: string } | null | "gone">(null);
  const [goneText, setGoneText] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call<{ byName: string; place: string }>(`/api/auth/invite?token=${encodeURIComponent(token)}`).then((result) => {
      if (result.ok) setInvite(result.data);
      else { setGoneText(result.error); setInvite("gone"); }
    });
  }, [token]);

  // A username from the name, until the person writes their own.
  const [userTouched, setUserTouched] = useState(false);
  const suggested = name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/)[0]?.replace(/[^a-z0-9._-]/g, "") ?? "";
  const shownUsername = userTouched ? username : suggested;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await serverFetch("/api/auth/invite", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, displayName: name.trim(), username: shownUsername.trim().toLowerCase(), password, label: defaultDeviceLabel() }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        location.replace("/");
        return;
      }
      setError(typeof data?.error === "string" ? data.error : `Error ${res.status}`);
    } catch {
      setError("No se pudo conectar con OpenBot. Revisa tu conexión.");
    }
    setBusy(false);
  }

  if (invite === null) return <Shell><p className="flex items-center justify-center gap-2 text-[14px] text-ink-secondary"><Loader2 size={15} className="animate-spin" /> Abriendo tu invitación…</p></Shell>;
  if (invite === "gone") {
    return (
      <Shell>
        <h1 className="text-center text-[22px] font-bold">Esta invitación ya no sirve</h1>
        <p className="text-center text-[14px] text-ink-secondary">{goneText}</p>
        <a href="/pair" className={`${primary} mt-2`}>Ir a entrar</a>
      </Shell>
    );
  }
  return (
    <Shell>
      <h1 className="text-center text-[24px] font-bold tracking-[-0.01em] text-balance">{invite.byName} te invita a {invite.place || placeName}</h1>
      <p className="-mt-1 mb-3 text-center text-[14px] text-ink-secondary">Crea tu cuenta para entrar. Tu contraseña solo la sabes tú.</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input id="invite-name" aria-label="Tu nombre" placeholder="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={field} autoFocus />
        <input id="invite-username" aria-label="Usuario para entrar" placeholder="Usuario para entrar" value={shownUsername} onChange={(e) => { setUserTouched(true); setUsername(e.target.value); }} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} className={field} />
        <PasswordField id="invite-password" value={password} onChange={setPassword} placeholder="Contraseña (mínimo 8)" autoComplete="new-password" />
        <Problem text={error} />
        <button type="submit" disabled={busy || !name.trim() || shownUsername.trim().length < 2 || password.length < 8} className={`${primary} mt-1`}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : null} {busy ? "Creando tu cuenta…" : "Crear cuenta y entrar"}
        </button>
      </form>
    </Shell>
  );
}

/** /pair and a signed-out page: the username and password page where this OpenBot offers it, else the original page. */
export function OpenbotSignInGate({ fallback, hasCode, hasEmail, reason }: { fallback: ReactNode; hasCode: boolean; hasEmail: boolean; reason?: string | null }) {
  const [environment, setEnvironment] = useState<{ label?: string; capabilities?: { passwordSignIn?: boolean } } | null | "none">(null);
  useEffect(() => {
    serverFetch("/.well-known/openmausbot/environment").then((res) => (res.ok ? res.json() : "none")).then(setEnvironment, () => setEnvironment("none"));
  }, []);
  if (environment === null) return <main className="min-h-[100dvh] bg-app" />;
  const name = (environment !== "none" && environment.label?.trim()) || "OpenBot";
  // An invitation opens even before anyone has a username (the owner may invite before choosing their own).
  const token = invitationToken();
  if (token && environment !== "none") return <OpenbotInvitation token={token} name={name} />;
  const offered = environment !== "none" && environment.capabilities?.passwordSignIn === true;
  if (!offered || wantsPairingCode(hasCode, hasEmail)) return <>{fallback}</>;
  return <OpenbotSignIn name={name} reason={reason} />;
}
