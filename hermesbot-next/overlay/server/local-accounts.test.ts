import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createLocalAccounts, localEmail, localUsername, seedFirstAdmin } from "./local-accounts.ts";

const fresh = () => createLocalAccounts(mkdtempSync(join(tmpdir(), "openbot-accounts-")));

describe("OpenBot local accounts", () => {
  it("creates an account, signs it in with the right password only, and never stores the password", () => {
    const dir = mkdtempSync(join(tmpdir(), "openbot-accounts-"));
    const accounts = createLocalAccounts(dir);
    expect(accounts.save({ username: "Dani", displayName: "Dani", password: "secreto-123", role: "admin" }).ok).toBe(true);
    expect(accounts.verify("dani", "secreto-123")?.email).toBe("dani@openbot.local");
    expect(accounts.verify("dani", "otra-cosa")).toBeNull();
    expect(accounts.verify("nadie", "secreto-123")).toBeNull();
    expect(readFileSync(join(dir, "local-accounts.json"), "utf8")).not.toContain("secreto-123");
  });

  it("gives admins and members their scopes by their internal address", () => {
    const accounts = fresh();
    accounts.save({ username: "dani", password: "secreto-123", role: "admin" });
    accounts.save({ username: "socio", password: "secreto-456" });
    expect(accounts.scopes(localEmail("dani"))).toEqual(["admin", "client"]);
    expect(accounts.scopes(localEmail("socio"))).toEqual(["client"]);
    expect(accounts.scopes("someone@example.com")).toBeNull();
    expect(localUsername("socio@openbot.local")).toBe("socio");
  });

  it("keeps at least one admin and asks for a password on a new account", () => {
    const accounts = fresh();
    expect(accounts.save({ username: "dani" }).ok).toBe(false);
    accounts.save({ username: "dani", password: "secreto-123", role: "admin" });
    expect(accounts.save({ username: "dani", role: "member" }).ok).toBe(false);
    expect(accounts.remove("dani").ok).toBe(false);
    expect(accounts.save({ username: "x", password: "secreto-123" }).ok).toBe(false);
    expect(accounts.save({ username: "socio", password: "corta" }).ok).toBe(false);
  });

  it("seeds the first admin from the environment only when there is none", () => {
    const accounts = fresh();
    expect(seedFirstAdmin(accounts, { OPENBOT_ADMIN_USER: "dani", OPENBOT_ADMIN_PASSWORD: "secreto-123" })).toBe("dani");
    expect(seedFirstAdmin(accounts, { OPENBOT_ADMIN_USER: "otro", OPENBOT_ADMIN_PASSWORD: "secreto-123" })).toBeNull();
    expect(accounts.get("dani")?.role).toBe("admin");
  });
});
