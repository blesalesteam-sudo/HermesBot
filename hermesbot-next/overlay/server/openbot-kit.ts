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

// The kit as it sits written inside a stored page: marked, or (pages stored before the mark) known by the comment
// each file opens with.
const KIT_WRITTEN = /<style(?: data-openbot-kit)?>\n\/\* Kit de documentos hermesBot[\s\S]*?<\/style>/g;
const ENGINE_WRITTEN = /<script(?: data-openbot-kit)?>\n\/\* Motor de plantillas de OpenBot[\s\S]*?<\/script>/g;

const files = new Map<string, string | null>();

function styleTag(css: string): string {
  return `<style data-openbot-kit>\n${css.replace(/<\/style/gi, "<\\/style")}\n</style>`;
}
function scriptTag(js: string): string {
  return `<script data-openbot-kit>\n${js.replace(/<\/script/gi, "<\\/script")}\n</script>`;
}

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
    if (css !== null) out = out.replace(KIT_LINK, () => styleTag(css));
  }
  KIT_LINK.lastIndex = 0;
  if (ENGINE_SCRIPT.test(out)) {
    const js = kitFile("plantilla.js");
    if (js !== null) {
      out = out.replace(ENGINE_SCRIPT, () => scriptTag(js));
      template = true;
    }
  }
  ENGINE_SCRIPT.lastIndex = 0;
  return { html: out, template };
}

/** A stored page with the kit it carries replaced by today's: a template made last month draws with this month's
 * engine. A page that carries none comes back as it is. */
export function refreshOpenbotKit(html: string): string {
  if (!html.includes("Kit de documentos hermesBot") && !html.includes("Motor de plantillas de OpenBot")) return html;
  let out = html;
  const css = kitFile("kit.css");
  if (css !== null) out = out.replace(KIT_WRITTEN, () => styleTag(css));
  const js = kitFile("plantilla.js");
  if (js !== null) out = out.replace(ENGINE_WRITTEN, () => scriptTag(js));
  return out;
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
