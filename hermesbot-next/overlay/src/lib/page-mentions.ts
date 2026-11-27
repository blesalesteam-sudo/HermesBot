// OpenBot: when a reply names a page of this conversation by its title, the title becomes a small link to that page
// (an icon and the title), as the bot's own mention of it. The chat tells this module which pages a conversation has.
import { useSyncExternalStore } from "react";

export interface ThreadPage { id: string; title: string }

export const PAGE_MENTION_HREF = "#openbot-page-";
const NONE: readonly ThreadPage[] = [];
const pages = new Map<string, readonly ThreadPage[]>();
const listeners = new Set<() => void>();

export function setThreadPages(threadId: string, next: readonly ThreadPage[]): void {
  const now = pages.get(threadId) ?? NONE;
  if (now.length === next.length && now.every((page, index) => page.id === next[index]!.id && page.title === next[index]!.title)) return;
  pages.set(threadId, next);
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useThreadPages(threadId: string | undefined): readonly ThreadPage[] {
  return useSyncExternalStore(subscribe, () => (threadId ? pages.get(threadId) ?? NONE : NONE), () => NONE);
}

/** Whether `index` in `text` sits inside code (a fence or a backtick span) or inside a link already. */
function shielded(text: string, index: number, length: number): boolean {
  const before = text.slice(0, index);
  if ((before.match(/```/g)?.length ?? 0) % 2 === 1) return true;
  const line = before.slice(before.lastIndexOf("\n") + 1);
  if ((line.match(/`/g)?.length ?? 0) % 2 === 1) return true;
  if (/\[[^\]\n]*$/.test(line)) return true;
  return text.startsWith("](", index + length);
}

/** The first plain mention of each page's title, in any case, becomes a markdown link to the page; a title too short
 * to be a name (under 8 characters) is left alone. */
export function linkPageMentions(text: string, known: readonly ThreadPage[]): string {
  if (!known.length || !text) return text;
  let linked = text;
  for (const page of [...known].sort((a, b) => b.title.length - a.title.length)) {
    const title = page.title.trim();
    if (title.length < 8 || linked.includes(`${PAGE_MENTION_HREF}${page.id})`)) continue;
    // The reply may write the title in another case ("plan de lanzamiento"): it is still the page's name.
    const folded = linked.toLocaleLowerCase();
    const sameLength = folded.length === linked.length;
    const needle = sameLength ? title.toLocaleLowerCase() : title;
    const haystack = sameLength && needle.length === title.length ? folded : linked;
    let from = 0;
    for (;;) {
      const index = haystack.indexOf(haystack === folded ? needle : title, from);
      if (index < 0) break;
      if (!shielded(linked, index, title.length)) {
        const label = linked.slice(index, index + title.length).replace(/([\[\]\\])/g, "\\$1");
        linked = `${linked.slice(0, index)}[${label}](${PAGE_MENTION_HREF}${page.id})${linked.slice(index + title.length)}`;
        break;
      }
      from = index + title.length;
    }
  }
  return linked;
}
