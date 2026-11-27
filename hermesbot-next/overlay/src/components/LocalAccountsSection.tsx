// OpenBot: Ajustes → Personas. Quién usa este OpenBot (foto, nombre, a qué se dedica, rol) y, para los administradores,
// el botón «Invitar»: un enlace de un solo uso que caduca en 7 días, para que la otra persona elija su propia contraseña
// (server/routes/local-accounts.ts). También se puede hacer o quitar administrador, poner una contraseña nueva a quien la
// olvidó o quitar a alguien.
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Link2, Loader2, MoreHorizontal, Shield, Trash2, UserPlus } from "lucide-react";
import type { SessionState } from "../lib/session";
import { readSharedSessionState } from "../lib/shared-session";
import { canPairDevices } from "./ServerPairingCard";
import { call, type PersonSummary } from "./openbot/people-api";
import { obField, obPrimary, obQuiet, PersonAvatar } from "./openbot/OpenbotProfile";

type Role = "admin" | "member";
interface Account { username: string; displayName: string; role: Role; email: string; createdAt: number; owner?: boolean }
interface Invite { id: string; byName: string; createdAt: number; expiresAt: number; usedBy?: string }

const dateText = (ms: number) => new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "long" });

export function LocalAccountsSection() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [people, setPeople] = useState<PersonSummary[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [fresh, setFresh] = useState<{ link: string; invite: Invite } | null>(null);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [resetting, setResetting] = useState<{ username: string; password: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const admin = canPairDevices(session);

  const load = useCallback(async (isAdmin: boolean) => {
    const listed = await call<{ people: PersonSummary[] }>("/api/openbot/people");
    if (listed.ok) setPeople(listed.data.people); else setError(listed.error);
    if (!isAdmin) return;
    const [all, open] = await Promise.all([call<{ accounts: Account[] }>("/api/local-accounts"), call<{ invites: Invite[] }>("/api/openbot/invites")]);
    if (all.ok) setAccounts(all.data.accounts ?? []);
    if (open.ok) setInvites(open.data.invites ?? []);
  }, []);

  useEffect(() => {
    void readSharedSessionState().then((state) => {
      setSession(state);
      void load(canPairDevices(state));
    });
  }, [load]);

  async function run(key: string, work: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> {
    setBusy(key);
    setError(null);
    const result = await work();
    setBusy(null);
    if (!result.ok) setError(result.error ?? "No se pudo hacer.");
    else await load(admin);
    return result.ok;
  }

  async function invite() {
    setBusy("invite");
    setError(null);
    setCopied(false);
    const made = await call<{ token: string; invite: Invite }>("/api/openbot/invites", "POST");
    setBusy(null);
    if (!made.ok) return setError(made.error);
    setFresh({ link: `${location.origin}/pair?invitacion=${made.data.token}`, invite: made.data.invite });
    await load(admin);
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  }

  const accountOf = (person: PersonSummary) => accounts.find((account) => account.username === person.username);
  const open = invites.filter((one) => !one.usedBy && one.expiresAt > Date.now() && one.id !== fresh?.invite.id);

  return (
    <div data-openbot-people className="flex flex-col gap-4 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-[13px] text-ink-secondary">Cada persona entra con su usuario y su contraseña. Los bots saben quién les escribe y leen su perfil.</p>
        {admin ? (
          <button type="button" className={obPrimary} disabled={busy !== null} onClick={() => void invite()}>
            {busy === "invite" ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} Invitar
          </button>
        ) : null}
      </div>

      {fresh ? (
        <div data-openbot-invite className="flex flex-col gap-2.5 rounded-2xl border border-hairline/40 bg-app p-4">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-ink"><Link2 size={15} /> Enlace de invitación</p>
          <p className="text-[13px] text-ink-secondary">Mándaselo por WhatsApp o por correo. Al abrirlo pone su nombre, su usuario y su contraseña. Sirve una sola vez y caduca el {dateText(fresh.invite.expiresAt)}.</p>
          <div className="flex min-w-0 items-center gap-2 rounded-xl bg-inset p-1.5 pl-3">
            <code className="min-w-0 flex-1 select-all truncate font-mono text-[12px] text-ink-secondary">{fresh.link}</code>
            <button type="button" className={`${obPrimary} h-9 px-4`} onClick={() => void copy(fresh.link)}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copiado" : "Copiar"}</button>
          </div>
        </div>
      ) : null}

      {error ? <p role="alert" className="rounded-xl bg-inset px-4 py-3 text-[13px] text-danger">{error}</p> : null}

      {people === null ? (
        <p className="flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={14} className="animate-spin" /> Cargando…</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline/30 overflow-hidden rounded-2xl border border-hairline/30 bg-app">
          {people.map((person) => {
            const account = accountOf(person);
            const id = person.username ?? person.key;
            return (
              <li key={person.key} className="flex flex-col gap-3 px-4 py-3">
                <div className="flex items-center gap-3">
                  <PersonAvatar person={person} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ink">{person.name || person.username || "Sin nombre"}</span>
                    <span className="block truncate text-[12px] text-ink-secondary">{[person.username ? `@${person.username}` : "sin usuario todavía", person.job, person.devices ? `${person.devices} ${person.devices === 1 ? "aparato" : "aparatos"}` : null].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-inset px-2.5 py-1 text-[11px] font-semibold text-ink-secondary">{person.owner ? "Dueño" : person.role === "admin" ? "Administrador" : "Miembro"}</span>
                  {admin && account && !account.owner ? (
                    <button type="button" aria-label={`Opciones de ${person.name}`} onClick={() => setMenu(menu === id ? null : id)} className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-inset hover:text-ink"><MoreHorizontal size={16} /></button>
                  ) : null}
                </div>
                {menu === id && account ? (
                  <div className="flex flex-wrap gap-2 sm:pl-[52px]">
                    <button type="button" className={`${obQuiet} h-9`} disabled={busy !== null} onClick={() => void run(`role:${id}`, () => call("/api/local-accounts", "POST", { username: account.username, role: account.role === "admin" ? "member" : "admin" }))}>
                      <Shield size={14} /> {account.role === "admin" ? "Quitar administrador" : "Hacer administrador"}
                    </button>
                    <button type="button" className={`${obQuiet} h-9`} onClick={() => setResetting({ username: account.username, password: "" })}><KeyRound size={14} /> Nueva contraseña</button>
                    <button type="button" className={`${obQuiet} h-9 text-danger`} onClick={() => setConfirmRemove(account.username)}><Trash2 size={14} /> Quitar</button>
                  </div>
                ) : null}
                {account && resetting?.username === account.username ? (
                  <div className="flex flex-wrap gap-2 sm:pl-[52px]">
                    <input aria-label="Contraseña nueva" placeholder="Contraseña nueva (mínimo 8)" type="text" value={resetting.password} onChange={(e) => setResetting({ ...resetting, password: e.target.value })} className={`${obField} h-9 max-w-[240px]`} />
                    <button type="button" className={`${obPrimary} h-9`} disabled={resetting.password.length < 8 || busy !== null}
                      onClick={() => void run(`pw:${id}`, () => call("/api/local-accounts", "POST", { username: account.username, password: resetting.password })).then((ok) => { if (ok) setResetting(null); })}>Guardar</button>
                    <button type="button" className={`${obQuiet} h-9`} onClick={() => setResetting(null)}>Cancelar</button>
                  </div>
                ) : null}
                {account && confirmRemove === account.username ? (
                  <div className="flex flex-wrap items-center gap-2 sm:pl-[52px]">
                    <span className="text-[13px] text-ink">¿Quitar a {person.name}? Ya no podrá entrar; sus mensajes se quedan.</span>
                    <button type="button" className={`${obPrimary} h-9`} disabled={busy !== null}
                      onClick={() => void run(`del:${id}`, () => call(`/api/local-accounts/${encodeURIComponent(account.username)}`, "DELETE")).then(() => { setConfirmRemove(null); setMenu(null); })}>Sí, quitar</button>
                    <button type="button" className={`${obQuiet} h-9`} onClick={() => setConfirmRemove(null)}>Cancelar</button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {admin && open.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] font-medium text-ink-secondary">Invitaciones sin usar</p>
          {open.map((one) => (
            <div key={one.id} className="flex items-center gap-3 rounded-xl bg-inset/60 px-3 py-2 text-[13px] text-ink-secondary">
              <Link2 size={14} /> <span className="min-w-0 flex-1">Creada el {dateText(one.createdAt)} · caduca el {dateText(one.expiresAt)}</span>
              <button type="button" className="underline" onClick={() => void run(`rev:${one.id}`, () => call(`/api/openbot/invites/${one.id}`, "DELETE"))}>Anular</button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
