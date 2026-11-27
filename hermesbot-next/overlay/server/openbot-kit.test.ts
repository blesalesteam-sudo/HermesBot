import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppUse } from "../shared/app.ts";
import { expandOpenbotKit, forgetOpenbotKit, withOpenbotKit } from "./openbot-kit.ts";

type Page = { html: string; uses?: AppUse[] };

const before = process.env.OMB_SKILLS_DIR;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "openbot-kit-"));
  mkdirSync(join(root, "documentos-visuales"), { recursive: true });
  writeFileSync(join(root, "documentos-visuales", "kit.css"), "body{color:red}/* $& $1 */");
  writeFileSync(join(root, "documentos-visuales", "plantilla.js"), "window.ran = '</script>';");
  process.env.OMB_SKILLS_DIR = root;
  forgetOpenbotKit();
});

afterEach(() => {
  if (before === undefined) delete process.env.OMB_SKILLS_DIR; else process.env.OMB_SKILLS_DIR = before;
  forgetOpenbotKit();
});

describe("a page that links the house kit", () => {
  it("gets the stylesheet written in, as it is", () => {
    const made = expandOpenbotKit('<head><link rel="stylesheet" href="kit.css"></head><main class="doc"></main>');
    expect(made.html).toBe('<head><style>\nbody{color:red}/* $& $1 */\n</style></head><main class="doc"></main>');
    expect(made.template).toBe(false);
  });

  it("gets the template engine written in, with its closing tags made safe, and keeps its state", () => {
    const html = '<main id="plantilla"></main><script type="application/json" id="datos">{}</script><script src="plantilla.js"></script>';
    const made = withOpenbotKit<Page>({ html });
    expect(made.html).toContain("<script>\nwindow.ran = '<\\/script>';\n</script>");
    expect(made.html).toContain('<script type="application/json" id="datos">{}</script>');
    expect(made.uses).toEqual(["state"]);
  });

  it("adds state to what the page already uses, and leaves an update that already has it alone", () => {
    const html = '<script src="./plantilla.js"></script>';
    expect(withOpenbotKit<Page>({ html, uses: ["data"] }).uses).toEqual(["data", "state"]);
    expect(withOpenbotKit<Page>({ html }, ["state"]).uses).toBeUndefined();
    expect(withOpenbotKit<Page>({ html }, ["data"]).uses).toEqual(["data", "state"]);
  });

  it("leaves any other page untouched", () => {
    const value = { html: '<link rel="stylesheet" href="https://cdn.jsdelivr.net/x.css"><script src="app.js"></script>' };
    expect(withOpenbotKit(value)).toBe(value);
  });
});
