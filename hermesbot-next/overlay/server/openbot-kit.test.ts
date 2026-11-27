import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppUse } from "../shared/app.ts";
import { bundlePage } from "./chat-apps.ts";
import { expandOpenbotKit, forgetOpenbotKit, refreshOpenbotKit, withOpenbotKit } from "./openbot-kit.ts";

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
    expect(made.html).toBe('<head><style data-openbot-kit>\nbody{color:red}/* $& $1 */\n</style></head><main class="doc"></main>');
    expect(made.template).toBe(false);
  });

  it("gets the template engine written in, with its closing tags made safe, and keeps its state", () => {
    const html = '<main id="plantilla"></main><script type="application/json" id="datos">{}</script><script src="plantilla.js"></script>';
    const made = withOpenbotKit<Page>({ html });
    expect(made.html).toContain("<script data-openbot-kit>\nwindow.ran = '<\\/script>';\n</script>");
    expect(made.html).toContain('<script type="application/json" id="datos">{}</script>');
    expect(made.uses).toEqual(["state"]);
  });

  it("adds state to what the page already uses, and leaves an update that already has it alone", () => {
    const html = '<script src="./plantilla.js"></script>';
    expect(withOpenbotKit<Page>({ html, uses: ["data"] }).uses).toEqual(["data", "state"]);
    expect(withOpenbotKit<Page>({ html }, ["state"]).uses).toBeUndefined();
    expect(withOpenbotKit<Page>({ html }, ["data"]).uses).toEqual(["data", "state"]);
  });

  it("is written into a page shown from a folder too (show_html `path`), which then keeps its state", () => {
    const index = { path: "index.html", data: Buffer.from('<link rel="stylesheet" href="kit.css"><main id="plantilla"></main><script src="plantilla.js"></script>') };
    const made = bundlePage({ files: [index], source: "/work/tareas", skipped: [] } as never, "Tareas");
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.page.html).toContain("body{color:red}");
    expect(made.page.html).toContain("window.ran");
    expect(made.page.uses).toEqual(["state"]);
  });

  it("leaves any other page untouched", () => {
    const value = { html: '<link rel="stylesheet" href="https://cdn.jsdelivr.net/x.css"><script src="app.js"></script>' };
    expect(withOpenbotKit(value)).toBe(value);
  });
});

describe("a stored page that carries the house kit", () => {
  const CSS_V1 = "/* Kit de documentos hermesBot: v1 */\nbody{color:red}";
  const JS_V1 = "/* Motor de plantillas de OpenBot. v1 */\nwindow.ran = '</script>';";
  const kit = (css: string, js: string) => {
    const root = process.env.OMB_SKILLS_DIR!;
    writeFileSync(join(root, "documentos-visuales", "kit.css"), css);
    writeFileSync(join(root, "documentos-visuales", "plantilla.js"), js);
    forgetOpenbotKit();
  };
  const page = '<head><link rel="stylesheet" href="kit.css"><style>h1{color:blue}</style></head><main id="plantilla"></main>' +
    '<script type="application/json" id="datos">{"titulo":"T"}</script><script src="plantilla.js"></script><script>window.own = 1;</script>';

  it("draws with today's kit and engine, and keeps everything of its own", () => {
    kit(CSS_V1, JS_V1);
    const stored = expandOpenbotKit(page).html;
    kit(CSS_V1.replace("red", "green").replace("v1", "v2"), JS_V1.replace("v1", "v2").replace("ran", "ranAgain"));
    const now = refreshOpenbotKit(stored);
    expect(now).toContain("body{color:green}");
    expect(now).not.toContain("body{color:red}");
    expect(now).toContain("window.ranAgain = '<\\/script>';");
    expect(now).not.toContain("window.ran =");
    expect(now).toContain("<style>h1{color:blue}</style>");
    expect(now).toContain('<script type="application/json" id="datos">{"titulo":"T"}</script>');
    expect(now).toContain("<script>window.own = 1;</script>");
    expect(refreshOpenbotKit(now)).toBe(now);
  });

  it("is brought up to date too when it was stored before the kit was marked", () => {
    kit(CSS_V1.replace("v1", "v2"), JS_V1.replace("v1", "v2"));
    const old = `<head><style>\n${CSS_V1}\n</style></head><main id="plantilla"></main><script>\n${JS_V1.replace("</script>", "<\\/script>")}\n</script><p>fin</p>`;
    const now = refreshOpenbotKit(old);
    expect(now).toContain("hermesBot: v2");
    expect(now).toContain("OpenBot. v2");
    expect(now).not.toContain("v1");
    expect(now.endsWith("<p>fin</p>")).toBe(true);
  });

  it("is left alone when it carries no kit, or when the kit files are gone", () => {
    const other = "<style>\nbody{}</style><script>\nlet a = 1;</script>";
    expect(refreshOpenbotKit(other)).toBe(other);
    kit(CSS_V1, JS_V1);
    const stored = expandOpenbotKit(page).html;
    process.env.OMB_SKILLS_DIR = join(process.env.OMB_SKILLS_DIR!, "nowhere");
    forgetOpenbotKit();
    expect(refreshOpenbotKit(stored)).toBe(stored);
  });
});
