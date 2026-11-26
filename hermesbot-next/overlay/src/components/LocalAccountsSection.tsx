// OpenBot: Ajustes → Personas → Usuarios. Los administradores crean cuentas de usuario y contraseña, cambian el
// nombre, el rol o la contraseña y las borran (server/routes/local-accounts.ts). Cada usuario entra con lo suyo y los
// bots saben quién escribe cada mensaje.
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, Plus, Shield, Trash2, User } from "lucide-react";
import { serverFetch } from "@/lib/relay-server";
import type { SessionState } from "../lib/session";
import { readSharedSessionState } from "../lib/shared-session";
import { canPairDevices } from "./ServerPairingCard";

type Role = "admin" | "member";
interface Account { username: string; displayName: string; role: Role; email: string; createdAt: number }

const input = "w-full rounded-md border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent-border";
const small = "inline-flex items-center gap-1 rounded-md border border-hairline/40 px-2 py-1 text-[12px] text-ink-secondary hover:text-ink disabled:opacity-50";

async function call(path: string, method: string, body?: unknown): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  try {
    const res = await serverFetch(path, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data } : { ok: false, error: typeof data?.error === "string" ? data.error : `Error ${res.status}` };
  } catch {
    return { ok: false, error: "No se pudo conectar con el servidor." };
  }
}

export function LocalAccountsSection() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState({ username: "", displayName: "", password: "", role: "member" as Role });

  const load = useCallback(async () => {
    const result = await call("/api/local-accounts", "GET");
    if (result.ok) setAccounts(result.data.accounts ?? []);
    else setError(result.error);
  }, []);

  useEffect(() => {
    void readSharedSessionState().then((state) => {
      setSession(state);
      if (canPairDevices(state)) void load();
    });
  }, [load]);

  if (!canPairDevices(session)) return null;

  async function save(body: Record<string, unknown>, key: string): Promise<boolean> {
    setBusy(key);
    setError(null);
    const result = await call("/api/local-accounts", "POST", body);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    await load();
    return true;
  }

  async function remove(account: Account) {
    if (!window.confirm(`¿Borrar a ${account.displayName}? Ya no podrá entrar. Sus mensajes se quedan en los chats.`)) return;
    setBusy(`del:${account.username}`);
    setError(null);
    const result = await call(`/api/local-accounts/${encodeURIComponent(account.username)}`, "DELETE");
    setBusy(null);
    if (!result.ok) setError(result.error);
    else await load();
  }

  async function changePassword(account: Account) {
    const password = window.prompt(`Nueva contraseña para ${account.displayName} (mínimo 8 caracteres):`);
    if (!password) return;
    await save({ username: account.username, password }, `pw:${account.username}`);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await save({ ...draft, username: draft.username.trim().toLowerCase() }, "add")) setDraft({ username: "", displayName: "", password: "", role: "member" });
  }

  return (
    <div data-openbot-accounts className="flex flex-col gap-3 py-2">
      <p className="text-[13px] text-ink-secondary">
        Cada persona entra con su usuario y su contraseña. Todos trabajáis con los mismos bots, y los bots saben quién escribe cada mensaje.
        Los administradores pueden crear usuarios y cambiar los ajustes.
      </p>
      {accounts === null ? (
        <p className="flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={14} className="animate-spin" /> Cargando usuarios…</p>
      ) : accounts.length === 0 ? (
        <p className="text-[13px] text-ink-secondary">Todavía no hay usuarios. Crea el primero abajo: si es tu cuenta, hazla administradora.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline/40 rounded-md border border-hairline/40">
          {accounts.map((account) => (
            <li key={account.username} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-inset text-ink-secondary">
                {account.role === "admin" ? <Shield size={15} /> : <User size={15} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink">{account.displayName}</span>
                <span className="block truncate text-[12px] text-ink-secondary">{account.username} · {account.role === "admin" ? "Administrador" : "Miembro"}</span>
              </span>
              <button type="button" className={small} disabled={busy !== null} onClick={() => void save({ username: account.username, role: account.role === "admin" ? "member" : "admin" }, `role:${account.username}`)}>
                <Shield size={12} /> {account.role === "admin" ? "Quitar admin" : "Hacer admin"}
              </button>
              <button type="button" className={small} disabled={busy !== null} onClick={() => void changePassword(account)}>
                <KeyRound size={12} /> Contraseña
              </button>
              <button type="button" className={small} disabled={busy !== null} onClick={() => void remove(account)} aria-label={`Borrar a ${account.displayName}`}>
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="grid grid-cols-1 gap-2 rounded-md border border-hairline/40 p-3 sm:grid-cols-2">
        <p className="text-[13px] font-medium text-ink sm:col-span-2">Añadir usuario</p>
        <input aria-label="Nombre" placeholder="Nombre (lo que verán los bots)" value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} className={input} />
        <input aria-label="Usuario" placeholder="Usuario (para entrar)" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} autoCapitalize="none" spellCheck={false} className={input} />
        <input aria-label="Contraseña" type="password" placeholder="Contraseña (mínimo 8)" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} autoComplete="new-password" className={input} />
        <select aria-label="Rol" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })} className={input}>
          <option value="member">Miembro</option>
          <option value="admin">Administrador</option>
        </select>
        {error ? <p role="alert" className="text-[13px] text-danger sm:col-span-2">{error}</p> : null}
        <button type="submit" disabled={busy !== null || !draft.username.trim() || draft.password.length < 8} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink disabled:opacity-50 sm:col-span-2">
          {busy === "add" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Añadir usuario
        </button>
      </form>
    </div>
  );
}
