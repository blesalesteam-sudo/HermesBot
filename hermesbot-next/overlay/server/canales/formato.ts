// OpenBot: el texto de los bots (Markdown) pasado a lo que entiende cada aplicación.
// WhatsApp tiene su propio formato (*negrita*, _cursiva_, ~tachado~, ```código```); Telegram va en texto plano
// para que nunca falle un mensaje por un símbolo mal cerrado.
import type { Canal } from "./ajustes.ts";

const TAGS_INTERNAS = /<\/?(attached-image|attached-file|pasted-text|widget|citation)\b[^>]*>/gi;

export function formatear(markdown: string, canal: Canal): string {
  const bloques: string[] = [];
  // El código no se toca: se aparta y se devuelve al final.
  let texto = markdown.replace(TAGS_INTERNAS, "").replace(/```[\w-]*\n?([\s\S]*?)```/g, (_m, codigo: string) => {
    bloques.push(canal === "whatsapp" ? "```" + codigo.replace(/\n$/, "") + "```" : codigo.replace(/\n$/, ""));
    return `\u0000${bloques.length - 1}\u0000`;
  });
  const negrita = canal === "whatsapp" ? (t: string) => `*${t}*` : (t: string) => t;
  texto = texto
    // Tablas: las filas quedan como «a · b · c» y desaparece la raya de debajo de la cabecera.
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, "")
    .replace(/^\s*\|(.+)\|\s*$/gm, (_m, fila: string) => fila.split("|").map((c) => c.trim()).filter(Boolean).join(" · "))
    // Títulos.
    .replace(/^#{1,6}\s+(.+?)\s*#*\s*$/gm, (_m, t: string) => negrita(t.replace(/\*\*/g, "")))
    // Negrita y cursiva de Markdown (primero la negrita, que usa los mismos signos).
    .replace(/\*\*(.+?)\*\*/g, (_m, t: string) => `\u0001${t}\u0001`)
    .replace(/__(.+?)__/g, (_m, t: string) => `\u0001${t}\u0001`)
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, (_m, a: string, t: string) => `${a}${canal === "whatsapp" ? `_${t}_` : t}`)
    .replace(/\u0001(.+?)\u0001/g, (_m, t: string) => negrita(t))
    .replace(/~~(.+?)~~/g, (_m, t: string) => (canal === "whatsapp" ? `~${t}~` : t))
    // Enlaces: «texto (dirección)», o solo la dirección si el texto es la misma.
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_m, alt: string, url: string) => (alt ? `${alt}: ${url}` : url))
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, t: string, url: string) => (t === url ? url : `${t} (${url})`))
    // Listas con guion o asterisco → viñeta.
    .replace(/^(\s*)[-*+]\s+/gm, "$1• ")
    // Citas.
    .replace(/^>\s?/gm, canal === "whatsapp" ? "> " : "")
    // Separadores.
    .replace(/^\s*([-*_])\1{2,}\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return texto.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => bloques[Number(i)] ?? "");
}

/** Las opciones de los permisos vienen en inglés desde la base: se enseñan en español. */
const OPCIONES: Record<string, string> = {
  allow: "Permitir",
  "allow once": "Permitir esta vez",
  "always allow": "Permitir siempre",
  "allow always": "Permitir siempre",
  "allow for this chat": "Permitir en esta conversación",
  deny: "Denegar",
  "don't allow": "No permitir",
  cancel: "Cancelar",
  yes: "Sí",
  no: "No",
};

export function opcionEnEspanol(opcion: string): string {
  return OPCIONES[opcion.trim().toLowerCase()] ?? opcion;
}

/** Quita acentos y mayúsculas para comparar nombres y respuestas. */
export function normal(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const SI = new Set(["si", "sí", "s", "vale", "ok", "okay", "dale", "adelante", "permitir", "permite", "permitelo", "hazlo", "yes", "y", "claro"]);
const NO = new Set(["no", "n", "denegar", "deniega", "niega", "cancela", "cancelar", "nope", "para"]);

export function esSi(texto: string): boolean {
  return SI.has(normal(texto).replace(/[.!¡]/g, ""));
}
export function esNo(texto: string): boolean {
  return NO.has(normal(texto).replace(/[.!¡]/g, ""));
}
