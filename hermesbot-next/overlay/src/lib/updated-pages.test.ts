import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { linkPageMentions, PAGE_MENTION_HREF } from "./page-mentions";
import { placeUpdatedPages } from "./updated-pages";

const text = (id: string, at: number): Message => ({ id, at, role: "bot", kind: "text", text: id } as Message);
const page = (id: string, at: number, updatedAt?: number): Message => ({
  id, at, role: "bot", kind: "app", text: id,
  app: { v: 1, source: "html", title: id, doc: "d", rev: updatedAt ? 1 : 0, bytes: 1, border: true, network: { connect: [], resources: [] }, ...(updatedAt ? { updatedAt } : {}) },
} as Message);

describe("a page updated later in the conversation", () => {
  it("is drawn where it was updated, with a note where it first appeared", () => {
    const placed = placeUpdatedPages([text("a", 1), page("p", 2, 5), text("b", 3), text("c", 4), text("d", 6)]);
    expect(placed.map((m) => m.id)).toEqual(["a", "p:earlier", "b", "c", "p", "d"]);
    expect(placed[1]!.app?.movedBelow).toBe("p");
    expect(placed[4]!.at).toBe(5);
  });

  it("stays put when nothing came between it and its update, or it was never updated", () => {
    const same = [text("a", 1), page("p", 2, 3), text("b", 4), page("q", 5)];
    expect(placeUpdatedPages(same)).toBe(same);
  });
});

describe("a reply that names a page", () => {
  const known = [{ id: "p1", title: "Plan de lanzamiento" }];
  it("links the first plain mention of the title", () => {
    expect(linkPageMentions("Mira el Plan de lanzamiento. El Plan de lanzamiento sigue.", known))
      .toBe(`Mira el [Plan de lanzamiento](${PAGE_MENTION_HREF}p1). El Plan de lanzamiento sigue.`);
  });
  it("leaves code, existing links and short titles alone", () => {
    expect(linkPageMentions("`Plan de lanzamiento`", known)).toBe("`Plan de lanzamiento`");
    expect(linkPageMentions("[Plan de lanzamiento](https://x.test)", known)).toBe("[Plan de lanzamiento](https://x.test)");
    expect(linkPageMentions("el Plan", [{ id: "p2", title: "Plan" }])).toBe("el Plan");
  });
});
