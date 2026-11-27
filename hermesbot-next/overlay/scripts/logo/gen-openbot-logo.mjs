// Logo OpenBot v5: volumen como el icono de Grok Bot: negro plano, personaje de "arcilla" blanca que se agrisa
// hacia abajo, ojos hundidos con halo blanco, filo blanco brillante en el borde del icono. Sin sombras oscuras.
import { writeFileSync } from "node:fs";
const out = process.argv[2] ?? ".";
const superellipse = (cx, cy, a, b, n, steps = 360) => {
  const p = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
    p.push(`${(cx + a * Math.sign(c) * Math.abs(c) ** (2 / n)).toFixed(2)} ${(cy + b * Math.sign(s) * Math.abs(s) ** (2 / n)).toFixed(2)}`);
  }
  return `M${p.join("L")}Z`;
};
const P = { scale: 4.6, x: 555, y: 815, rot: -11, A: 140, B: 112, n: 2.4, eyeY: -40, eyeW: 26, eyeH: 64, eyeGap: 44, stalkW: 10, tipR: 15, ant: 50, stalkTop: -138 };
const HEAD = superellipse(0, 0, P.A, P.B, P.n);
const topAt = (x) => -P.B * (1 - Math.abs(x / P.A) ** P.n) ** (1 / P.n);
const stalk = (x, w, top) => {
  const h = w / 2, f = w * 1.4, yl = topAt(x - h - f), yr = topAt(x + h + f), yc = topAt(x);
  return `M${x - h} ${top}L${x + h} ${top}L${x + h} ${yc - f}Q${x + h} ${yr} ${x + h + f} ${yr + 1}L${x + h + f} ${yr + 12}L${x - h - f} ${yl + 12}L${x - h - f} ${yl + 1}Q${x - h} ${yl} ${x - h} ${yc - f}Z`;
};
const tipCircle = (x) => `M${x - P.tipR} ${P.stalkTop}A${P.tipR} ${P.tipR} 0 1 1 ${x + P.tipR} ${P.stalkTop}A${P.tipR} ${P.tipR} 0 1 1 ${x - P.tipR} ${P.stalkTop}Z`;
const BODY = `${HEAD}${stalk(-P.ant, P.stalkW, P.stalkTop)}${stalk(P.ant, P.stalkW, P.stalkTop)}${tipCircle(-P.ant)}${tipCircle(P.ant)}`;
const eyes = (attrs, dx = 0, dy = 0, grow = 0) => [-P.eyeGap, P.eyeGap].map((cx) => {
  const w = P.eyeW + grow * 2, h = P.eyeH + grow * 2;
  return `<rect x="${cx - w / 2 + dx}" y="${P.eyeY - h / 2 + dy}" width="${w}" height="${h}" rx="${w / 2}" ${attrs} transform="rotate(-26 ${cx} ${P.eyeY})"/>`;
}).join("");

function icon(id, tile) {
  const mac = tile === "mac", square = tile === "square";
  const size = mac ? 824 : 1024, off = (1024 - size) / 2;
  const r = square ? 0.001 : size * 0.235, k = r * 0.62, L = off, R = off + size, T = off, Bt = off + size;
  const TILE = `M${L + r} ${T}H${R - r}C${R - r + k} ${T} ${R} ${T + r - k} ${R} ${T + r}V${Bt - r}C${R} ${Bt - r + k} ${R - r + k} ${Bt} ${R - r} ${Bt}H${L + r}C${L + r - k} ${Bt} ${L} ${Bt - r + k} ${L} ${Bt - r}V${T + r}C${L} ${T + r - k} ${L + r - k} ${T} ${L + r} ${T}Z`;
  const robotT = `translate(${off} ${off}) scale(${size / 1024}) translate(${P.x} ${P.y}) rotate(${P.rot}) scale(${P.scale})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs>
  <clipPath id="${id}t"><path d="${TILE}"/></clipPath>
  <clipPath id="${id}h"><path d="${BODY}"/></clipPath>
  <linearGradient id="${id}body" x1="0" y1="${T}" x2="0" y2="${Bt}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".42" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E9E9EB"/></linearGradient>
  <linearGradient id="${id}rim" x1="0" y1="${T}" x2="0" y2="${Bt}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".45" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></linearGradient>
  <filter id="${id}b2" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.6"/></filter>
  <filter id="${id}b5" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="4.5"/></filter>
  <filter id="${id}b14" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="${id}b20" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="20"/></filter>
  </defs>
  ${mac ? `<path d="${TILE}" fill="#000" opacity=".28" filter="url(#${id}b20)" transform="translate(0 12)"/>` : ""}
  <g clip-path="url(#${id}t)">
    <rect width="1024" height="1024" fill="#000"/>
    <path d="${BODY}" transform="${robotT}" fill="url(#${id}body)"/>
    <g clip-path="url(#${id}h)" transform="${robotT}">
      <!-- hueco de los ojos: sombra suave hacia abajo y un halo blanco pegado al borde -->
      ${eyes(`fill="#000" opacity=".10" filter="url(#${id}b5)"`, 2.5, 5, 5)}
      ${eyes(`fill="none" stroke="#fff" stroke-width="5" filter="url(#${id}b2)"`)}
      <!-- brillo blanco en el filo de arriba de la cabeza -->
      <path d="${BODY}" fill="none" stroke="#fff" stroke-width="3" filter="url(#${id}b2)"/>
    </g>
    <g transform="${robotT}">${eyes(`fill="#000"`)}</g>
    <!-- bisel del icono: banda gris suave por dentro y filo blanco brillante -->
    <g clip-path="url(#${id}h)" transform="${robotT}"><g transform="${`scale(${1 / P.scale}) rotate(${-P.rot}) translate(${-P.x} ${-P.y}) scale(${1024 / size}) translate(${-off} ${-off})`}">
      <path d="${TILE}" fill="none" stroke="#000" stroke-opacity=".09" stroke-width="34" filter="url(#${id}b14)"/>
    </g></g>
    <path d="${TILE}" fill="none" stroke="url(#${id}rim)" stroke-width="${mac ? 7 : 8}" filter="url(#${id}b2)"/>
  </g></svg>`;
}
const V = { mac: icon("m", "mac"), full: icon("f", "full"), square: icon("s", "square") };
for (const [k, svg] of Object.entries(V)) writeFileSync(`${out}/logo5-${k}.svg`, svg);
const small = (k) => `<div class="row"><div style="width:64px">${V[k]}</div><div style="width:32px">${V[k]}</div><div style="width:16px">${V[k]}</div></div>`;
writeFileSync(`${out}/sheet5.html`, `<!doctype html><meta charset=utf-8><style>body{margin:0;background:#ECEDEF;font:600 24px system-ui;display:flex;gap:36px;padding:28px}.c{display:grid;gap:14px;justify-items:center}.big{width:400px}.row{display:flex;gap:16px;align-items:end}svg,img{display:block;width:100%}</style>
<div class="c"><div class="big"><img src="grok-big.png"></div><div class="row" style="height:64px"></div><b>Grok Bot (referencia)</b></div>
<div class="c"><div class="big">${V.mac}</div>${small("full")}<b>OpenBot</b></div>`);
