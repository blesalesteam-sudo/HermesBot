// OpenBot: a page that was replaced later in the conversation is shown where it was last updated, and a small row
// stays where it first appeared, saying it was updated further down. Nothing is stored for this: the list the chat
// draws is rearranged from each page's `updatedAt`.
import type { Message } from "@/state/store";

const MOVED_SUFFIX = ":earlier";

export function placeUpdatedPages(messages: Message[]): Message[] {
  let moves: Array<{ from: number; after: number; at: number }> | null = null;
  for (let index = 0; index < messages.length - 1; index++) {
    const message = messages[index]!;
    const updatedAt = message.kind === "app" && message.app?.source === "html" ? message.app.updatedAt : undefined;
    if (typeof updatedAt !== "number") continue;
    let after = index;
    for (let later = messages.length - 1; later > index; later--) {
      if (messages[later]!.at <= updatedAt) { after = later; break; }
    }
    if (after > index) (moves ??= []).push({ from: index, after, at: updatedAt });
  }
  if (!moves) return messages;
  const landing = new Map<number, Message[]>();
  const stubs = new Map<number, Message>();
  for (const move of moves) {
    const page = messages[move.from]!;
    stubs.set(move.from, { ...page, id: `${page.id}${MOVED_SUFFIX}`, reactions: undefined, app: { ...page.app!, movedBelow: page.id } });
    const row = landing.get(move.after) ?? [];
    row.push({ ...page, at: move.at });
    landing.set(move.after, row);
  }
  const placed: Message[] = [];
  messages.forEach((message, index) => {
    placed.push(stubs.get(index) ?? message);
    const arrivals = landing.get(index);
    if (arrivals) placed.push(...arrivals.sort((a, b) => a.at - b.at));
  });
  return placed;
}

/** Scrolls the chat to a page's card and gives it a moment's emphasis. */
export function showPageCard(messageId: string): void {
  const card = document.querySelector<HTMLElement>(`[data-app="${CSS.escape(messageId)}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.setAttribute("data-page-found", "");
  setTimeout(() => card.removeAttribute("data-page-found"), 1600);
}

/** Opens a page from anywhere in the chat: its card's own button when the card is ready, else just shows the card. */
export function openPageCard(messageId: string): void {
  const open = document.querySelector<HTMLButtonElement>(`[data-app="${CSS.escape(messageId)}"] [data-page-open]`);
  if (open) open.click();
  else showPageCard(messageId);
}
