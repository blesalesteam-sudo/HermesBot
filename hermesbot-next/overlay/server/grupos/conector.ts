// OpenBot: lo que comparten los conectores de WhatsApp y Telegram, tanto para los grupos (server/grupos) como para
// las conversaciones privadas con los bots (server/canales).
import type { Plataforma } from "./ajustes.ts";

/** Una foto, archivo o nota de voz que llega en un chat privado. En los grupos no se descarga nada. */
export interface Adjunto {
  tipo: "imagen" | "archivo" | "audio";
  datos: Buffer;
  mime: string;
  nombre: string;
}

export interface Entrante {
  plataforma: Plataforma;
  chatId: string;
  chatNombre: string;
  autor: string;
  texto: string;
  fecha: number;
  mensajeId: string;
  /** Alguien mencionó al bot o respondió a un mensaje suyo. */
  aludeAlBot: boolean;
  /** Chat privado (uno a uno) en vez de grupo. */
  privado?: boolean;
  /** Quién escribe, para saber si es alguien autorizado: el número de WhatsApp (solo dígitos) o el id de Telegram. */
  remitente?: string;
  adjuntos?: Adjunto[];
}

export type EstadoConexion = "apagado" | "conectando" | "esperando-qr" | "conectado" | "error";

export interface EstadoConector {
  estado: EstadoConexion;
  /** Con quién está conectado: el @usuario del bot de Telegram o el número de WhatsApp. */
  cuenta?: string;
  error?: string;
  /** Solo WhatsApp mientras espera a que se escanee. Se dibuja en la página, nunca sale a otro servicio. */
  qr?: string;
}

export interface ArchivoSaliente {
  path: string;
  nombre: string;
  mime: string;
  texto?: string;
}

export interface Conector {
  estado(): EstadoConector;
  arrancar(): void;
  parar(): Promise<void>;
  /** Solo lo llama el modo bajo demanda, y solo en respuesta a quien aludió al bot. */
  responder(chatId: string, texto: string, aMensajeId: string): Promise<void>;
  /** Chats privados: un mensaje nuevo (sin citar a nadie). */
  enviar(chatId: string, texto: string): Promise<void>;
  enviarArchivo(chatId: string, archivo: ArchivoSaliente): Promise<void>;
  /** Muestra «escribiendo…» unos segundos. */
  escribiendo(chatId: string): void;
}

/** Telegram corta en 4096 caracteres y WhatsApp se lee mal con mensajes enormes. */
export const MAX_RESPUESTA = 3500;

/** Parte un texto largo en trozos que caben en un mensaje, cortando por párrafos o líneas cuando se puede. */
export function trocear(texto: string, max = MAX_RESPUESTA): string[] {
  const trozos: string[] = [];
  let resto = texto.trim();
  while (resto.length > max) {
    let corte = resto.lastIndexOf("\n\n", max);
    if (corte < max * 0.5) corte = resto.lastIndexOf("\n", max);
    if (corte < max * 0.5) corte = resto.lastIndexOf(" ", max);
    if (corte < max * 0.5) corte = max;
    trozos.push(resto.slice(0, corte).trimEnd());
    resto = resto.slice(corte).trimStart();
  }
  if (resto) trozos.push(resto);
  return trozos;
}
