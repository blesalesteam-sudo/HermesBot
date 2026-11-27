// OpenBot: a bot's page can link the house kit instead of copying it:
//   <link rel="stylesheet" href="kit.css">   the look of documents, dashboards and templates
//   <script src="plantilla.js"></script>      the template engine (lists with checkboxes, boards, tables, notes)
// Both are written into the page when it is shown, from skills/documentos-visuales/. A page that uses the template
// engine also gets the `state` use, so what the person changes in it is kept.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AppUse } from "../shared/app.ts";

const KIT_LINK = /<link\b[^>]*\bhref\s*=\s*["']?(?:\.\/)?kit\.css["']?[^>]*>/gi;
const ENGINE_SCRIPT = /<script\b[^>]*\bsrc\s*=\s*["']?(?:\.\/)?plantilla\.js["']?[^>]*>\s*<\/script>/gi;

const files = new Map<string, string | null>();

function kitFile(name: string): string | null {
  if (!files.has(name)) {
    const root = process.env.OMB_SKILLS_DIR || join(process.cwd(), "skills");
    try {
      files.set(name, readFileSync(join(root, "documentos-visuales", name), "utf8"));
    } catch {
      files.set(name, null);
    }
  }
  return files.get(name) ?? null;
}

/** For tests: forget what was read, so another skills folder can be tried. */
export function forgetOpenbotKit(): void {
  files.clear();
}

/** The page with the kit written in where it links it, and whether it runs the template engine. */
export function expandOpenbotKit(html: string): { html: string; template: boolean } {
  let template = false;
  let out = html;
  if (KIT_LINK.test(out)) {
    const css = kitFile("kit.css");
    // A function, so a `$` in the file is never read as a replacement pattern.
    if (css !== null) out = out.replace(KIT_LINK, () => `<style>\n${css.replace(/<\/style/gi, "<\\/style")}\n</style>`);
  }
  KIT_LINK.lastIndex = 0;
  if (ENGINE_SCRIPT.test(out)) {
    const js = kitFile("plantilla.js");
    if (js !== null) {
      out = out.replace(ENGINE_SCRIPT, () => `<script>\n${js.replace(/<\/script/gi, "<\\/script")}\n</script>`);
      template = true;
    }
  }
  ENGINE_SCRIPT.lastIndex = 0;
  return { html: out, template };
}

/** show_html / update_html input with the kit written in. `current`: what the page being replaced already uses. */
export function withOpenbotKit<T extends { html?: string; uses?: AppUse[] }>(value: T, current?: readonly AppUse[]): T {
  if (typeof value.html !== "string") return value;
  const expanded = expandOpenbotKit(value.html);
  if (expanded.html === value.html) return value;
  const uses = value.uses ?? (current ? [...current] : undefined);
  const next = expanded.template && !(uses ?? []).includes("state") ? [...(uses ?? []), "state" as const] : value.uses;
  return { ...value, html: expanded.html, ...(next !== undefined ? { uses: next } : {}) };
}
