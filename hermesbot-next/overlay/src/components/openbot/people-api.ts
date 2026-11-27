// OpenBot: lo que las pantallas de entrar, invitación y perfil piden al servidor (server/routes/local-accounts.ts).
import { useEffect, useState } from "react";
import { serverFetch } from "@/lib/relay-server";

export interface MyProfile {
  key: string;
  name: string;
  job: string;
  aboutMe: string;
  hasPhoto: boolean;
  username?: string;
  role?: "admin" | "member";
  owner: boolean;
  /** The owner on a device paired with a code, with no username and password yet. */
  needsAccount: boolean;
  passwordMin: number;
}

export interface PersonSummary { key: string; name: string; job: string; hasPhoto: boolean; username?: string; role?: "admin" | "member"; owner: boolean }

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export async function call<T = any>(path: string, method = "GET", body?: unknown): Promise<Result<T>> {
  try {
    const res = await serverFetch(path, { method, credentials: "same-origin", headers: body !== undefined ? { "content-type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, data } : { ok: false, error: typeof data?.error === "string" ? data.error : `Error ${res.status}` };
  } catch {
    return { ok: false, error: "No se pudo conectar con OpenBot. Revisa tu conexión." };
  }
}

// The signed-in person's own profile, shared by the sidebar, Settings and the account reminder.
let mine: MyProfile | null = null;
let photoVersion = Date.now();
const listeners = new Set<() => void>();
const changed = () => { for (const listener of listeners) listener(); };

export function myProfile(): MyProfile | null { return mine; }

export async function loadMyProfile(): Promise<MyProfile | null> {
  const result = await call<MyProfile>("/api/openbot/me");
  mine = result.ok ? result.data : null;
  changed();
  return mine;
}

export async function saveMyProfile(patch: Partial<Pick<MyProfile, "name" | "job" | "aboutMe">> & { photo?: string | null; password?: { current: string; next: string } }): Promise<Result<MyProfile>> {
  const result = await call<MyProfile>("/api/openbot/me", "PUT", patch);
  if (result.ok) {
    mine = result.data;
    if (patch.photo !== undefined) photoVersion = Date.now();
    changed();
  }
  return result;
}

export function useMyProfile(): MyProfile | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((tick) => tick + 1);
    listeners.add(listener);
    if (!mine) void loadMyProfile();
    return () => { listeners.delete(listener); };
  }, []);
  return mine;
}

export function photoUrl(key: string): string {
  return `/api/openbot/photo/${encodeURIComponent(key)}?v=${photoVersion}`;
}

/** A photo the person picked, made small and square (256 px JPEG) before it goes to the server. */
export function shrinkPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error("Elige una imagen (JPG, PNG o WebP)."));
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const size = 256, side = Math.min(image.naturalWidth, image.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("No se pudo leer la imagen."));
      context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo leer la imagen.")); };
    image.src = url;
  });
}

/** The same colour for the same person, from a short palette that reads on light and dark. */
const COLORS = ["#2f6df6", "#e8590c", "#7048e8", "#0c8599", "#d6336c", "#2b8a3e", "#5c7cfa", "#c2255c"];
export function personColor(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
