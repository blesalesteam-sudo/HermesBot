// OpenBot: «Tu perfil» en Ajustes (foto, nombre, a qué te dedicas, «Sobre ti» y contraseña), el aviso para que el dueño
// elija usuario y contraseña la primera vez, y la foto o inicial de cada persona.
import { useEffect, useRef, useState } from "react";
import { Camera, Check, Loader2 } from "lucide-react";
import { call, initials, loadMyProfile, personColor, photoUrl, saveMyProfile, shrinkPhoto, useMyProfile, type MyProfile } from "./people-api";

export const obField = "h-11 w-full rounded-xl border border-transparent bg-inset px-3.5 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-tertiary focus:border-hairline focus:bg-app";
export const obPrimary = "inline-flex h-10 items-center justify-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-accent-ink transition-opacity disabled:opacity-40";
export const obQuiet = "inline-flex h-10 items-center justify-center gap-2 rounded-full border border-hairline/60 px-4 text-[14px] font-medium text-ink transition-colors hover:bg-inset disabled:opacity-40";
const label = "text-[12px] font-medium text-ink-secondary";

export function PersonAvatar({ person, size = 40 }: { person: { key: string; name: string; username?: string; hasPhoto: boolean }; size?: number }) {
  const [broken, setBroken] = useState(false);
  const name = person.name || person.username || "?";
  if (person.hasPhoto && !broken) {
    return <img src={photoUrl(person.key)} alt="" width={size} height={size} onError={() => setBroken(true)} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span aria-hidden="true" className="flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: personColor(person.username || person.key), fontSize: Math.round(size * 0.38) }}>
      {initials(name)}
    </span>
  );
}

function ClaimForm({ me, onDone }: { me: MyProfile; onDone(): void }) {
  const [username, setUsername] = useState((me.name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/)[0]?.replace(/[^a-z0-9._-]/g, "") ?? "");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) return setError("Las dos contraseñas no coinciden.");
    setBusy(true);
    setError(null);
    const result = await call("/api/openbot/claim", "POST", { username: username.trim().toLowerCase(), password });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    await loadMyProfile();
    onDone();
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5">
      <input aria-label="Usuario" placeholder="Usuario" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} className={obField} />
      <input aria-label="Contraseña" placeholder={`Contraseña (mínimo ${me.passwordMin})`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={obField} />
      <input aria-label="Repite la contraseña" placeholder="Repite la contraseña" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" className={obField} />
      {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
      <button type="submit" disabled={busy || username.trim().length < 2 || password.length < me.passwordMin || !again} className={obPrimary}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : null} Guardar mi usuario
      </button>
    </form>
  );
}

const NUDGE_LATER = "openbot.claim-later";
const NUDGE_REST_MS = 7 * 24 * 60 * 60 * 1000;

function nudgeResting(): boolean {
  try {
    const at = Number(localStorage.getItem(NUDGE_LATER));
    return Number.isFinite(at) && at > 0 && Date.now() - at < NUDGE_REST_MS;
  } catch { return false; }
}

/** The owner, on a device paired with a code: one window in the middle of the screen that asks for the username and
 * password to use from now on. «Más tarde» puts it away for a week on this browser, so it never sits over the chat;
 * the same form stays in Ajustes → Tu cuenta. */
export function OpenbotAccountNudge() {
  const me = useMyProfile();
  const [later, setLater] = useState(nudgeResting);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const putAway = () => { try { localStorage.setItem(NUDGE_LATER, String(Date.now())); } catch {} setLater(true); };
  const asking = Boolean(me?.needsAccount) && !later && !done;
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 5000);
    return () => clearTimeout(timer);
  }, [done]);
  useEffect(() => {
    if (!asking) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") putAway(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [asking]);
  if (done) {
    return (
      <div data-openbot-nudge="done" role="status" className="pointer-events-none fixed inset-x-4 top-[max(16px,env(safe-area-inset-top))] z-[60] flex justify-center">
        <div className="flex max-w-[420px] items-center gap-2.5 rounded-full bg-accent px-4 py-2.5 text-accent-ink shadow-lg">
          <Check size={16} /> <span className="text-[14px]">Listo. Desde ahora entras con tu usuario y tu contraseña.</span>
        </div>
      </div>
    );
  }
  if (!me || !asking) return null;
  return (
    <div data-openbot-nudge className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) putAway(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="openbot-nudge-title" className="w-full max-w-[400px] rounded-3xl border border-hairline/30 bg-app p-6 text-center text-ink shadow-2xl">
        <img src="/openbot-logo.svg" alt="" width={52} height={52} className="mx-auto size-[52px]" />
        <p id="openbot-nudge-title" className="mt-4 text-[18px] font-semibold tracking-[-0.01em]">Crea tu usuario y contraseña</p>
        <p className="mx-auto mt-1.5 max-w-[320px] text-[14px] leading-5 text-ink-secondary">Así entras desde cualquier sitio sin códigos. No pierdes nada de lo que tienes.</p>
        {open ? <div className="mt-5 text-left"><ClaimForm me={me} onDone={() => setDone(true)} /></div> : (
          <div className="mt-5 flex flex-col gap-2">
            <button type="button" autoFocus className={obPrimary} onClick={() => setOpen(true)}>Crear ahora</button>
            <button type="button" className={obQuiet} onClick={putAway}>Más tarde</button>
          </div>
        )}
        <p className="mt-4 text-[12px] text-ink-tertiary">{open ? <button type="button" className="underline" onClick={putAway}>Ahora no</button> : "Lo tienes siempre en Ajustes → Tu cuenta."}</p>
      </div>
    </div>
  );
}

/** Settings → Account: the signed-in person's own profile. */
export function OpenbotProfileCard() {
  const me = useMyProfile();
  const [draft, setDraft] = useState<{ name: string; job: string; aboutMe: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pw, setPw] = useState<{ current: string; next: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (me && !draft) setDraft({ name: me.name, job: me.job, aboutMe: me.aboutMe }); }, [me, draft]);
  if (!me || !draft) return <p className="flex items-center gap-2 px-1 py-4 text-[13px] text-ink-secondary"><Loader2 size={14} className="animate-spin" /> Cargando tu perfil…</p>;

  const dirty = draft.name !== me.name || draft.job !== me.job || draft.aboutMe !== me.aboutMe;
  async function save() {
    setBusy("save");
    setNote(null);
    const result = await saveMyProfile(draft!);
    setBusy(null);
    setNote(result.ok ? { ok: true, text: "Guardado. Tus bots ya lo saben." } : { ok: false, text: result.error });
  }
  async function pickPhoto(picked: File | undefined) {
    if (!picked) return;
    setBusy("photo");
    setNote(null);
    try {
      const result = await saveMyProfile({ photo: await shrinkPhoto(picked) });
      if (!result.ok) setNote({ ok: false, text: result.error });
    } catch (error) {
      setNote({ ok: false, text: error instanceof Error ? error.message : "No se pudo subir la foto." });
    }
    setBusy(null);
  }
  async function changePassword() {
    if (!pw) return;
    setBusy("pw");
    setNote(null);
    const result = await saveMyProfile({ password: pw });
    setBusy(null);
    if (result.ok) setPw(null);
    setNote(result.ok ? { ok: true, text: "Contraseña cambiada." } : { ok: false, text: result.error });
  }

  return (
    <div data-openbot-profile className="flex flex-col gap-5 rounded-2xl border border-hairline/30 bg-app p-4 sm:p-5">
      <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
        <button type="button" onClick={() => file.current?.click()} className="group relative rounded-full" aria-label="Cambiar foto">
          <PersonAvatar person={{ ...me, name: draft.name || me.name }} size={84} />
          <span className="absolute bottom-0 right-0 flex size-7 items-center justify-center rounded-full border-2 border-app bg-accent text-accent-ink">
            {busy === "photo" ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
          </span>
        </button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
        <div className="min-w-0">
          <p className="truncate text-[19px] font-semibold text-ink">{me.name || me.username || "Tú"}</p>
          <p className="text-[13px] text-ink-secondary">
            {[me.username ? `@${me.username}` : null, me.owner ? "Dueño" : me.role === "admin" ? "Administrador" : "Miembro"].filter(Boolean).join(" · ")}
            {me.hasPhoto ? <> · <button type="button" className="underline" onClick={() => void saveMyProfile({ photo: null })}>Quitar foto</button></> : null}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5"><span className={label}>Nombre</span>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={60} className={obField} /></label>
        <label className="flex flex-col gap-1.5"><span className={label}>A qué te dedicas</span>
          <input value={draft.job} placeholder="Por ejemplo: ventas y clientes" onChange={(e) => setDraft({ ...draft, job: e.target.value })} maxLength={80} className={obField} /></label>
      </div>
      <label className="flex flex-col gap-1.5"><span className={label}>Sobre ti (lo leen tus bots)</span>
        <textarea value={draft.aboutMe} rows={5} placeholder="Qué haces, cómo prefieres que te respondan, cosas que deben saber de ti…" onChange={(e) => setDraft({ ...draft, aboutMe: e.target.value })} maxLength={4000}
          className="w-full resize-y rounded-xl border border-transparent bg-inset px-3.5 py-3 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-tertiary focus:border-hairline focus:bg-app" /></label>
      {note ? <p role={note.ok ? "status" : "alert"} className={`text-[13px] ${note.ok ? "text-ink-secondary" : "text-danger"}`}>{note.text}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!dirty || busy !== null || !draft.name.trim()} onClick={() => void save()} className={obPrimary}>
          {busy === "save" ? <Loader2 size={15} className="animate-spin" /> : null} Guardar
        </button>
        {me.username && !pw ? <button type="button" className={obQuiet} onClick={() => setPw({ current: "", next: "" })}>Cambiar contraseña</button> : null}
      </div>
      {pw ? (
        <div className="flex flex-col gap-2.5 rounded-xl bg-inset/50 p-3">
          <input aria-label="Contraseña actual" placeholder="Contraseña actual" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" className={obField} />
          <input aria-label="Contraseña nueva" placeholder={`Contraseña nueva (mínimo ${me.passwordMin})`} type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" className={obField} />
          <div className="flex gap-2">
            <button type="button" className={obPrimary} disabled={busy !== null || !pw.current || pw.next.length < me.passwordMin} onClick={() => void changePassword()}>Cambiar</button>
            <button type="button" className={obQuiet} onClick={() => setPw(null)}>Cancelar</button>
          </div>
        </div>
      ) : null}
      {me.needsAccount ? (
        <div className="flex flex-col gap-3 border-t border-hairline/30 pt-4">
          <p className="text-[14px] font-semibold text-ink">Tu usuario y contraseña</p>
          <p className="-mt-2 text-[13px] text-ink-secondary">Todavía entras con un código. Elige usuario y contraseña para entrar desde cualquier sitio.</p>
          <ClaimForm me={me} onDone={() => setNote({ ok: true, text: "Listo. Desde ahora entras con tu usuario y tu contraseña." })} />
        </div>
      ) : null}
    </div>
  );
}
