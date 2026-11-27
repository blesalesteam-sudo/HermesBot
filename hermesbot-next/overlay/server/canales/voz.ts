// OpenBot: guarda lo que llega por WhatsApp o Telegram como adjunto de la app, y transcribe las notas de voz con el
// servicio de voz que esté configurado en OpenBot (Fish Audio o la clave propia de ElevenLabs). Sin servicio de voz,
// la nota se le da al bot como archivo.
import type { AppConfig } from "../config.ts";
import { saveAudio, saveFile, saveImage } from "../attachments.ts";
import { voiceCredential } from "../included-services.ts";
import * as elevenlabs from "../tts/elevenlabs.ts";
import * as fish from "../tts/fish.ts";
import type { Adjunto } from "../grupos/conector.ts";

const comillas = (v: string) => v.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]!);

async function* trozos(datos: Buffer): AsyncIterable<Uint8Array> {
  yield datos;
}

/** La etiqueta que la app pone en el mensaje para que el bot vea la foto o el archivo, o null si no se pudo guardar. */
export async function guardarAdjunto(a: Adjunto): Promise<string | null> {
  try {
    if (a.tipo === "imagen") {
      const mime = a.mime === "image/jpg" ? "image/jpeg" : a.mime;
      try {
        const saved = saveImage(a.datos, mime);
        return `<attached-image path="${comillas(saved.path)}" name="${comillas(a.nombre)}" />`;
      } catch {
        // Un formato de imagen que la app no admite como foto va como archivo.
      }
    }
    if (a.tipo === "audio") {
      try {
        const saved = saveAudio(a.datos, a.mime);
        return `<attached-file path="${comillas(saved.path)}" name="${comillas(a.nombre)}" />`;
      } catch {
        // sigue como archivo normal
      }
    }
    const saved = await saveFile(trozos(a.datos), a.nombre, a.mime, { expectedBytes: a.datos.byteLength, keepOriginal: true });
    return `<attached-file path="${comillas(saved.path)}" name="${comillas(a.nombre)}" />`;
  } catch {
    return null;
  }
}

/** El texto de una nota de voz, o null si no hay servicio de voz o falló. */
export async function transcribir(a: Adjunto, cfg: AppConfig): Promise<string | null> {
  const mime = a.mime.split(";")[0]!.trim();
  try {
    const fishKey = cfg.tts?.fishKey;
    if (fishKey) return (await fish.transcribe(a.datos, mime, fishKey)).trim() || null;
    const own = voiceCredential(cfg.tts?.key);
    if (own && !own.included) return (await elevenlabs.transcribe(a.datos, mime, own.token, own.api, cfg.tts?.hearLanguage)).trim() || null;
  } catch {
    return null;
  }
  return null;
}
