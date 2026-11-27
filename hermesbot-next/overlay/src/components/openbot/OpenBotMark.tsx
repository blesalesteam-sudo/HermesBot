// OpenBot: el logo y el nombre de la app arriba a la izquierda de la barra lateral (modo sencillo).
import { PRODUCT_NAME } from "@/lib/brand";

export function OpenBotMark() {
  return (
    <div data-openbot-mark className="flex min-w-0 select-none items-center gap-2 pt-[1px]">
      <img src="/openbot-logo.svg" alt="" width={28} height={28} draggable={false} className="size-7 shrink-0" />
      <span className="truncate text-[16px] font-semibold tracking-[-0.01em] text-ink">{PRODUCT_NAME}</span>
    </div>
  );
}
