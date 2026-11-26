// Marca propia al construir: "MausBot" es marca de sus autores, así que este producto se llama OpenBot.
// Se ejecuta sobre el código de OpenMausBot ya descargado (carpeta actual), después de los parches.
// No toca las frases que hablan del servicio de pago de los autores (MausBot Cloud), de enviarles informes
// ni del nombre del proyecto (OpenMausBot): cambiarlas diría algo falso.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const NAME = "OpenBot";
const BOT_NAME = "Hermes";

// Cambia `from` por `to`. Si ya está `to` (lo puso un parche), no hace nada. Si no está ninguno, para la
// construcción: la base ha cambiado y hay que revisar el script.
function replaceExact(file, from, to) {
  const text = readFileSync(file, "utf8");
  if (text.includes(to)) return;
  if (!text.includes(from)) throw new Error(`rebrand: no encuentro ${JSON.stringify(from)} en ${file}; revisa el script tras subir de versión`);
  writeFileSync(file, text.replace(from, to));
}

// El nombre del producto ya lo pone patches/20-nombre-openbot.patch; esto solo lo asegura.
replaceExact("server/brand.ts", 'export const PRODUCT_NAME = "MausBot";', `export const PRODUCT_NAME = "${NAME}";`);
replaceExact("src/lib/brand.ts", 'export const PRODUCT_NAME = "MausBot";', `export const PRODUCT_NAME = "${NAME}";`);
replaceExact("packages/phone-protocol/src/default-bot.ts", 'export const DEFAULT_BOT_NAME = "MausBot";', `export const DEFAULT_BOT_NAME = "${BOT_NAME}";`);

// Textos de la interfaz, en todos los idiomas.
const KEEP = /OpenMausBot|MausBot Cloud|Milind|Omkar/;
let changed = 0;
for (const name of readdirSync("src/locales").filter((f) => f.endsWith(".json") && f !== "source-hashes.json")) {
  const file = join("src/locales", name);
  const strings = JSON.parse(readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(strings)) {
    if (typeof value !== "string" || !value.includes("MausBot") || KEEP.test(value)) continue;
    strings[key] = value.replaceAll("MausBot", NAME);
    changed++;
  }
  writeFileSync(file, JSON.stringify(strings, null, 2) + "\n");
}
console.log(`rebrand: ${NAME} en ${changed} textos de la interfaz`);
