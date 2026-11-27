// OpenBot: the "Crear nuevo Bot" / "Editar Bot" panel, laid out like Grok Bot's: a big preview, the name, the shapes
// and the colours, then Cancelar and Crear (or Guardar). New bots open it from "Bot nuevo"; existing ones from their
// menu in the sidebar ("Editar Bot").
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { MausAvatar } from "./Avatar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { colorSwatch } from "@/lib/mascot";
import { bodyName, colorName } from "@/lib/mascot-names";
import { imeComposing } from "@/lib/send-key";
import { BOT_PROFILE_LIMITS } from "../../shared/bot-profile";
import type { BotBodyId } from "../../shared/bot-body";
import type { MausColor } from "../../shared/wire";

/** The shapes and colours the panel offers, in Grok Bot's order. */
export const LOOK_SHAPES: readonly BotBodyId[] = ["blob", "cloud", "square", "sparkle", "clover", "heart", "flower", "drop", "tablet", "wedge", "house", "star", "hexagon"];
export const LOOK_COLORS: readonly MausColor[] = ["chrome", "coral", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "silver"];

export interface BotLook {
  name: string;
  color: MausColor;
  body: BotBodyId;
}

interface Request {
  initial?: Partial<BotLook> & { antennas?: boolean };
  edit: boolean;
  resolve: (look: BotLook | null) => void;
}

let open: ((request: Request) => void) | null = null;

/** True while the panel is mounted with the app. */
export const hasBotLookPanel = (): boolean => open !== null;

/** Opens the panel; resolves with the chosen look, or null when the person cancels. */
export function askBotLook(initial?: Request["initial"], edit = false): Promise<BotLook | null> {
  const show = open;
  if (!show) return Promise.resolve(null);
  return new Promise((resolve) => show({ initial, edit, resolve }));
}

const anyOf = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

export function BotLookDialogHost() {
  const [request, setRequest] = useState<Request | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState<BotBodyId>("blob");
  const [color, setColor] = useState<MausColor>("silver");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    open = (next) => {
      setName(next.initial?.name ?? "");
      setBody(next.initial?.body ?? anyOf(LOOK_SHAPES));
      setColor(next.initial?.color ?? anyOf(LOOK_COLORS));
      setRequest(next);
    };
    return () => { open = null; };
  }, []);

  useEffect(() => {
    if (!request) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [request]);

  if (!request) return null;
  const done = (look: BotLook | null) => { setRequest(null); request.resolve(look); };
  const ready = name.trim().length > 0;
  const submit = () => { if (ready) done({ name: name.trim(), color, body }); };
  const title = request.edit ? t("botLook.editTitle") : t("botLook.createTitle");

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) done(null); }}>
      <form
        data-bot-look
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-look-title"
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-[414px] flex-col overflow-hidden rounded-[18px] bg-menu text-ink shadow-2xl"
        onSubmit={(event) => { event.preventDefault(); submit(); }}
        onKeyDown={(event) => {
          if (imeComposing(event.nativeEvent)) { event.stopPropagation(); return; }
          if (event.key === "Escape") { event.stopPropagation(); done(null); }
        }}
      >
        <div className="flex items-center justify-between border-b border-hairline/40 px-4 py-3">
          <h2 id="bot-look-title" className="text-[15px] font-semibold">{title}</h2>
          <button type="button" aria-label={t("common.close")} onClick={() => done(null)} className="grid size-[30px] place-items-center rounded-full text-ink-secondary hover:bg-raised">
            <X size={17} />
          </button>
        </div>

        <div className="flex flex-col items-center gap-4 overflow-y-auto px-4 pb-5 pt-4">
          <MausAvatar color={color} bodyId={body} antennas={request.initial?.antennas} size={112} state="idle" label={name.trim() || title} />

          <input
            ref={input}
            value={name}
            maxLength={BOT_PROFILE_LIMITS.name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("botLook.namePlaceholder")}
            aria-label={t("botLook.nameLabel")}
            className="w-full rounded-xl border border-hairline/40 bg-menu px-3 py-2 text-center text-[15px] text-ink placeholder:text-ink-tertiary outline-none focus:border-hairline focus-visible:outline-none focus-visible:shadow-none"
          />

          <div role="group" aria-label={t("botLook.shapes")} className="mt-1 flex w-[265px] flex-wrap justify-center gap-[8px]">
            {LOOK_SHAPES.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={body === id}
                aria-label={t("botLook.shape", { name: bodyName(id) })}
                title={bodyName(id)}
                onClick={() => setBody(id)}
                className={cn("grid size-[45px] place-items-center rounded-full transition", body === id ? "ring-[1.5px] ring-hairline bg-menu shadow-sm" : "hover:bg-raised")}
              >
                <MausAvatar color={color} bodyId={id} size={34} state="idle" animated={false} trackPointer={false} />
              </button>
            ))}
          </div>

          <div role="group" aria-label={t("botLook.colors")} className="mt-2 flex w-[230px] flex-wrap justify-center gap-[10px]">
            {LOOK_COLORS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={color === id}
                aria-label={colorName(id)}
                title={colorName(id)}
                onClick={() => setColor(id)}
                className={cn("grid size-[30px] place-items-center rounded-full", color === id && "ring-[1.5px] ring-hairline")}
              >
                <span className="block size-[24px] rounded-full" style={{ background: colorSwatch(id) }} />
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-hairline/40 px-3 py-3">
          <button type="button" onClick={() => done(null)} className="rounded-full border border-hairline/50 px-4 py-1.5 text-[14px] text-ink hover:bg-raised">{t("common.cancel")}</button>
          <button type="submit" disabled={!ready} className="rounded-full bg-accent px-4 py-1.5 text-[14px] font-medium text-accent-ink disabled:bg-raised disabled:text-ink-tertiary">
            {request.edit ? t("botLook.save") : t("botLook.create")}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
