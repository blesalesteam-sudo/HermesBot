/**
 * OpenBot · the bot shapes, drawn for OpenBot.
 *
 * Writes `packages/phone-protocol/src/mascot-bodies.ts` with the same fields the base
 * generator (`scripts/gen-mascot-bodies.ts`) writes, so nothing else has to change. The
 * differences:
 *   - The catalog follows the shape-picker idea of Grok Bot (25 simple shapes in a grid),
 *     but every outline here is OpenBot's own drawing.
 *   - Every shape wears the two antennas of the OpenBot robot. Their round tips are
 *     separate circles with the class `omb-tip`, so the theme can light them up while the
 *     bot is thinking or working (see `public/openbot-theme.css`).
 *   - The ids the base already stored (cursor, blob, circle, squircle, capsule, drop,
 *     shield, hexagon, diamond, star) stay, so old bots keep their shape.
 *
 * Run from the app root: node --experimental-strip-types scripts/gen-openbot-bodies.ts
 * Only the web renderer is written; the phone catalogs are left alone.
 */

import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { MOUTH_STROKE } from "../src/components/cursor-face-data.ts"
import { applyFit, boundsOf, fitTransform, flatten } from "./mascot-bodies/geometry.ts"
import { maskFromPolylines } from "./mascot-bodies/raster.ts"
import { fieldFromMask, largestInscribedCircle, type Sdf } from "./mascot-bodies/sdf.ts"
import { buildClouds, maxScaleAt, report } from "./mascot-bodies/solve.ts"

type Pt = [number, number]
type Sextet = [number, number, number, number, number, number]

// ---------------------------------------------------------------- path helpers

const KAPPA = 0.5522847498307936

function fmt(n: number): string {
  let s = n.toFixed(3)
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "")
  return s === "-0" ? "0" : s
}

/** Cubics only (`M`, `C`, `Z`), like the base catalog. */
class Path {
  private parts: string[] = []
  private origin: Pt = [0, 0]
  private at: Pt = [0, 0]
  moveTo(x: number, y: number): Path {
    this.parts.push("M" + fmt(x) + " " + fmt(y))
    this.origin = [x, y]
    this.at = [x, y]
    return this
  }
  curveTo(c: Sextet): Path {
    this.parts.push("C" + c.map(fmt).join(" "))
    this.at = [c[4], c[5]]
    return this
  }
  lineTo(x: number, y: number): Path {
    const [x0, y0] = this.at
    return this.curveTo([x0 + (x - x0) / 3, y0 + (y - y0) / 3, x0 + (2 * (x - x0)) / 3, y0 + (2 * (y - y0)) / 3, x, y])
  }
  quadTo(cx: number, cy: number, x: number, y: number): Path {
    const [x0, y0] = this.at
    return this.curveTo([x0 + (2 / 3) * (cx - x0), y0 + (2 / 3) * (cy - y0), x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y), x, y])
  }
  /** A quarter ellipse to (x, y), bulging towards the box corner (kx, ky). */
  quarterTo(kx: number, ky: number, x: number, y: number): Path {
    const [x0, y0] = this.at
    return this.curveTo([x0 + (kx - x0) * KAPPA, y0 + (ky - y0) * KAPPA, x + (kx - x) * KAPPA, y + (ky - y) * KAPPA, x, y])
  }
  close(): string {
    const [x, y] = this.at
    const [sx, sy] = this.origin
    if (Math.abs(x - sx) > 1e-9 || Math.abs(y - sy) > 1e-9) this.lineTo(sx, sy)
    return this.parts.join("") + "Z"
  }
}

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** A smooth closed curve through sampled points: quadratics between the midpoints. */
function smooth(pts: Pt[]): string {
  const n = pts.length
  const mid = (i: number): Pt => lerp(pts[i % n], pts[(i + 1) % n], 0.5)
  const p = new Path().moveTo(...mid(0))
  for (let i = 1; i <= n; i++) {
    const c = pts[i % n]
    const m = mid(i)
    p.quadTo(c[0], c[1], m[0], m[1])
  }
  return p.close()
}

/** Samples `at(t)` for t in [0, 1) and smooths it. */
function sampled(steps: number, at: (t: number) => Pt): string {
  return smooth(Array.from({ length: steps }, (_, i) => at(i / steps)))
}

/** A polygon with every corner cut back along both edges and rounded across. */
function roundedPolygon(pts: Pt[], round: number): string {
  const n = pts.length
  const p = new Path()
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]
    const cur = pts[i]
    const next = pts[(i + 1) % n]
    const a = lerp(cur, prev, round * 0.5)
    const b = lerp(cur, next, round * 0.5)
    if (i === 0) p.moveTo(a[0], a[1])
    else p.lineTo(a[0], a[1])
    p.quadTo(cur[0], cur[1], b[0], b[1])
  }
  return p.close()
}

function regular(w: number, h: number, sides: number, turn = -Math.PI / 2, cy = 100): Pt[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2 + turn
    return [100 + Math.cos(a) * (w / 2), cy + Math.sin(a) * (h / 2)] as Pt
  })
}

function ellipse(w: number, h: number, cy = 100): string {
  const rx = w / 2
  const ry = h / 2
  return new Path()
    .moveTo(100 + rx, cy)
    .quarterTo(100 + rx, cy + ry, 100, cy + ry)
    .quarterTo(100 - rx, cy + ry, 100 - rx, cy)
    .quarterTo(100 - rx, cy - ry, 100, cy - ry)
    .quarterTo(100 + rx, cy - ry, 100 + rx, cy)
    .close()
}

function roundedBox(w: number, h: number, radius: number, top = 100 - h / 2): string {
  const x = 100 - w / 2
  const y = top
  const k = Math.min(radius, w / 2, h / 2)
  const p = new Path().moveTo(x + k, y)
  if (w - 2 * k > 1e-9) p.lineTo(x + w - k, y)
  p.quarterTo(x + w, y, x + w, y + k)
  if (h - 2 * k > 1e-9) p.lineTo(x + w, y + h - k)
  p.quarterTo(x + w, y + h, x + w - k, y + h)
  if (w - 2 * k > 1e-9) p.lineTo(x + k, y + h)
  p.quarterTo(x, y + h, x, y + h - k)
  if (h - 2 * k > 1e-9) p.lineTo(x, y + k)
  p.quarterTo(x, y, x + k, y)
  return p.close()
}

/** A box whose top is a half ellipse of height `cap` and whose bottom corners round by `foot`. */
function domed(w: number, h: number, cap: number, foot: number): string {
  const x0 = 100 - w / 2
  const x1 = 100 + w / 2
  const top = 100 - h / 2
  const bottom = 100 + h / 2
  const shoulder = top + cap
  return new Path()
    .moveTo(x0, shoulder)
    .quarterTo(x0, top, 100, top)
    .quarterTo(x1, top, x1, shoulder)
    .lineTo(x1, bottom - foot)
    .quarterTo(x1, bottom, x1 - foot, bottom)
    .lineTo(x0 + foot, bottom)
    .quarterTo(x0, bottom, x0, bottom - foot)
    .close()
}

/** The base's blob: a circle whose radius breathes around the turn. */
function blob(w: number, h: number, wobble: number, phase = 0.6, cy = 100): string {
  return sampled(24, t => {
    const a = t * Math.PI * 2
    const r = 1 + Math.sin(a * 3 + phase) * 0.07 * wobble + Math.sin(a * 2 - 1.1) * 0.05 * wobble
    return [100 + Math.cos(a) * (w / 2) * r, cy + Math.sin(a) * (h / 2) * r]
  })
}

/** The base's drop, unchanged. */
function drop(w: number, h: number, belly: number): string {
  const hw = w / 2
  const top = 100 - h / 2
  const b = h * (0.3 + belly * 0.35)
  const waist = 100 + h / 2 - hw
  return new Path()
    .moveTo(100, top)
    .curveTo([100 + hw * 0.78, top + b * 0.75, 100 + hw, top + b, 100 + hw, waist])
    .quarterTo(100 + hw, waist + hw, 100, waist + hw)
    .quarterTo(100 - hw, waist + hw, 100 - hw, waist)
    .curveTo([100 - hw, top + b, 100 - hw * 0.78, top + b * 0.75, 100, top])
    .close()
}

/** The base's shield (its `cone`), unchanged. */
function shield(w: number, h: number, tip: number, base: number): string {
  const hw = w / 2
  const hh = h / 2
  const t = hw * tip
  const b = hw * base * 0.55
  return new Path()
    .moveTo(100 - t, 100 - hh + t * 0.9)
    .quadTo(100, 100 - hh, 100 + t, 100 - hh + t * 0.9)
    .lineTo(100 + hw - b * 0.4, 100 + hh - b)
    .quadTo(100 + hw, 100 + hh, 100 + hw - b, 100 + hh)
    .lineTo(100 - hw + b, 100 + hh)
    .quadTo(100 - hw, 100 + hh, 100 - hw + b * 0.4, 100 + hh - b)
    .close()
}

function star(w: number, h: number, points: number, inner: number, round: number): string {
  const pts: Pt[] = []
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2
    const k = i % 2 === 0 ? 1 : inner
    pts.push([100 + Math.cos(a) * (w / 2) * k, 100 + Math.sin(a) * (h / 2) * k])
  }
  return roundedPolygon(pts, round)
}

/** A radius that swells into `lobes` round lobes. */
function lobed(size: number, lobes: number, depth: number, turn: number): string {
  return sampled(lobes * 16, t => {
    const a = t * Math.PI * 2
    const wave = Math.abs(Math.cos(((a - turn) * lobes) / 2))
    const r = (size / 2) * (1 - depth + depth * Math.pow(wave, 0.55))
    return [100 + Math.cos(a) * r, 100 + Math.sin(a) * r]
  })
}

// ---------------------------------------------------------------- the shapes

/** The OpenBot robot's head: the logo, without its antennas. */
const ROBOT_HEAD = roundedBox(200, 156, 56, 44)

/** `dx` brings the antennas closer on shapes with a narrow top. */
const SHAPES: { id: string; name: string; d: string; dx?: number }[] = [
  { id: "cursor", name: "Robot", d: ROBOT_HEAD },
  { id: "blob", name: "Blob", d: blob(200, 200, 0.35) },
  { id: "pebble", name: "Pebble", d: blob(200, 168, 0.55, 2.1) },
  {
    id: "bean",
    name: "Bean",
    d: sampled(64, t => {
      const a = t * Math.PI * 2
      const x = Math.cos(a)
      const y = Math.sin(a)
      const dent = 0.2 * Math.exp(-((x + 1) ** 2) * 1.6) * (1 - y * y)
      return [100 + x * 100 * (1 - dent * 0.2) + dent * 60, 100 + y * 82]
    }),
  },
  {
    id: "egg",
    dx: 34,
    name: "Egg",
    d: sampled(64, t => {
      const a = t * Math.PI * 2
      const y = Math.sin(a)
      return [100 + Math.cos(a) * 80 * (1 + 0.14 * y), 100 + y * 100]
    }),
  },
  { id: "squircle", name: "Squircle", d: roundedBox(200, 200, 50) },
  { id: "tablet", name: "Tablet", d: roundedBox(152, 200, 30) },
  { id: "capsule", name: "Capsule", d: roundedBox(150, 200, 75) },
  {
    id: "cylinder",
    name: "Cylinder",
    d: new Path()
      .moveTo(20, 24)
      .quarterTo(20, 0, 100, 0)
      .quarterTo(180, 0, 180, 24)
      .lineTo(180, 176)
      .quarterTo(180, 200, 100, 200)
      .quarterTo(20, 200, 20, 176)
      .close(),
  },
  { id: "hexagon", name: "Hexagon", d: roundedPolygon(regular(196, 196, 6), 0.12) },
  { id: "diamond", name: "Gem", dx: 26, d: roundedPolygon(regular(196, 196, 4), 0.12) },
  { id: "crystal", name: "Crystal", dx: 28, d: roundedPolygon([[100, 0], [168, 46], [168, 154], [100, 200], [32, 154], [32, 46]], 0.16) },
  { id: "wedge", name: "Wedge", dx: 20, d: roundedPolygon([[100, 8], [200, 192], [0, 192]], 0.3) },
  { id: "shield", name: "Shield", dx: 30, d: shield(190, 200, 0.45, 0.9) },
  { id: "dome", name: "Dome", d: domed(200, 160, 100, 22) },
  { id: "arch", name: "Arch", dx: 36, d: domed(156, 200, 78, 16) },
  {
    id: "cloud",
    name: "Cloud",
    d: sampled(96, t => {
      const a = t * Math.PI * 2
      const x = Math.cos(a)
      const y = Math.sin(a)
      const bumps = y < 0 ? 0.13 * Math.abs(Math.cos(a * 2.5)) * -y : 0
      const r = 1 + bumps
      return [100 + x * 100 * r, 112 + Math.max(y * 72 * r, -110) * (y > 0 ? 0.78 : 1)]
    }),
  },
  { id: "drop", name: "Drop", dx: 26, d: drop(156, 194, 0.62) },
  {
    id: "leaf",
    dx: 26,
    name: "Leaf",
    d: sampled(64, t => {
      const a = t * Math.PI * 2
      const s = Math.sin(a)
      return [100 + 78 * s * (0.35 + 0.65 * Math.abs(s)), 100 - 100 * Math.cos(a)]
    }),
  },
  { id: "square", name: "Square", d: roundedBox(196, 196, 22) },
  {
    id: "sparkle",
    dx: 18,
    name: "Sparkle",
    d: sampled(128, t => {
      const a = t * Math.PI * 2
      const r = 100 * (0.5 + 0.5 * Math.pow(Math.abs(Math.cos(a * 2)), 3))
      return [100 + Math.cos(a) * r, 100 + Math.sin(a) * r]
    }),
  },
  { id: "clover", name: "Clover", d: lobed(200, 4, 0.3, Math.PI / 4) },
  { id: "flower", name: "Flower", d: lobed(200, 6, 0.22, -Math.PI / 2) },
  {
    id: "heart",
    name: "Heart",
    d: sampled(96, t => {
      const a = t * Math.PI * 2
      const x = 16 * Math.sin(a) ** 3
      const y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)
      return [100 + x * 6.2, 92 - y * 6.2]
    }),
  },
  { id: "house", name: "House", dx: 30, d: roundedPolygon([[100, 0], [200, 84], [200, 200], [0, 200], [0, 84]], 0.2) },
  { id: "star", name: "Star", dx: 22, d: star(200, 196, 5, 0.62, 0.16) },
  { id: "circle", name: "Circle", d: ellipse(200, 200) },
]

// ---------------------------------------------------------------- antennas

/** As in the logo: two stalks 80 apart, 16 wide, with round tips of radius 16 that sit 36
 * above where each stalk meets the head. The stalk reaches 8 into the head. */
const ANTENNA = { dx: 40, stalk: 16, tip: 16, rise: 36, sink: 8 }

/** The top of an outline at x, in its own units. */
function topAt(d: string, x: number): number {
  let best = Infinity
  for (const ring of flatten(d)) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const [ax, ay] = a
      const [bx, by] = b
      if ((ax - x) * (bx - x) > 0 || ax === bx) {
        if (ax === x) best = Math.min(best, ay)
        continue
      }
      const y = ay + ((x - ax) / (bx - ax)) * (by - ay)
      best = Math.min(best, y)
    }
  }
  if (!Number.isFinite(best)) throw new Error(`no outline above x=${x}`)
  return best
}

interface Antennas {
  stalks: string
  tips: { cx: number; cy: number; r: number }[]
}

function antennasFor(d: string, dx = ANTENNA.dx): Antennas {
  const tips: Antennas["tips"] = []
  let stalks = ""
  for (const side of [-1, 1]) {
    const x = 100 + side * dx
    const top = topAt(d, x)
    const cy = top - ANTENNA.rise + ANTENNA.sink / 2
    const x0 = x - ANTENNA.stalk / 2
    const x1 = x + ANTENNA.stalk / 2
    stalks += new Path().moveTo(x0, cy).lineTo(x1, cy).lineTo(x1, top + ANTENNA.sink).lineTo(x0, top + ANTENNA.sink).close()
    tips.push({ cx: x, cy, r: ANTENNA.tip })
  }
  return { stalks, tips }
}

/** The tips as cubic circles, so the outline the solver sees includes them. */
function circlePath(cx: number, cy: number, r: number): string {
  return new Path()
    .moveTo(cx + r, cy)
    .quarterTo(cx + r, cy + r, cx, cy + r)
    .quarterTo(cx - r, cy + r, cx - r, cy)
    .quarterTo(cx - r, cy - r, cx, cy - r)
    .quarterTo(cx + r, cy - r, cx + r, cy)
    .close()
}

// ---------------------------------------------------------------- the face solve (as in gen-mascot-bodies.ts)

const AIMS = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 }] as const
const CLOUD_SETS = AIMS.map(aim => buildClouds(0, MOUTH_STROKE, aim))
const ALL_CLOUDS = CLOUD_SETS.flat()
const RASTER_SIZE = 256
const CAP = 1.5
const ROOM = 0.9

interface Anchor { x: number; y: number; scale: number }
const round = (n: number, places: number) => Number(n.toFixed(places))

function clearanceAt(sdf: Sdf, anchor: Anchor): number {
  let worst = Infinity
  for (const clouds of CLOUD_SETS) worst = Math.min(worst, report(clouds, sdf, anchor).clearance)
  return worst
}

function solve(outline: string, face: string): { fit: ReturnType<typeof fitTransform>; anchor: Anchor } {
  const fit = fitTransform(boundsOf(flatten(outline)))
  // The face may sit only in the head: the antennas are left out of the mask.
  const sdf = fieldFromMask(maskFromPolylines(applyFit(flatten(face), fit), RASTER_SIZE), RASTER_SIZE)
  const circle = largestInscribedCircle(sdf)
  let best: Anchor = { x: circle.x, y: circle.y, scale: maxScaleAt(ALL_CLOUDS, sdf, circle.x, circle.y, CAP) }
  let step = Math.max(circle.radius, 12)
  for (let level = 0; level < 8; level++) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (!dx && !dy) continue
        const x = best.x + dx * step
        const y = best.y + dy * step
        const scale = maxScaleAt(ALL_CLOUDS, sdf, x, y, CAP)
        if (scale > best.scale + 1e-4) best = { x, y, scale }
      }
    }
    step /= 2
  }
  const anchor: Anchor = { x: round(best.x, 2), y: round(best.y, 2), scale: Math.floor(best.scale * ROOM * 1000) / 1000 }
  for (let i = 0; i < 40 && anchor.scale > 0.02 && clearanceAt(sdf, anchor) < 0; i++) anchor.scale = round(anchor.scale - 0.005, 3)
  if (clearanceAt(sdf, anchor) < 0) throw new Error(`the face clips in ${face.slice(0, 20)}…`)
  return { fit, anchor }
}

// ---------------------------------------------------------------- emit

const quote = (s: string) => JSON.stringify(s)

function main(): void {
  const entries: string[] = []
  console.log("shape      face size")
  for (const shape of SHAPES) {
    const { stalks, tips } = antennasFor(shape.d, shape.dx)
    const outline = shape.d + stalks + tips.map(t => circlePath(t.cx, t.cy, t.r)).join("")
    const { fit, anchor } = solve(outline, shape.d)
    console.log(`  ${shape.id.padEnd(9)} ${anchor.scale.toFixed(3)}`)
    const tipMarkup = tips
      .map((t, i) => `<circle class="omb-tip omb-tip-${i ? "b" : "a"}" fill="{{GRADIENT}}" cx="${fmt(t.cx)}" cy="${fmt(t.cy)}" r="${t.r}"/>`)
      .join("")
    entries.push(
      [
        `  ${shape.id}: {`,
        `    id: ${quote(shape.id)},`,
        `    name: ${quote(shape.name)},`,
        `    fit: ${quote(fit.transform)},`,
        `    body: ${quote(`<path fill="{{GRADIENT}}" d="${shape.d}${stalks}"/>${tipMarkup}`)},`,
        `    clip: ${quote(`<path d="${shape.d}"/>`)},`,
        `    anchor: { x: ${anchor.x}, y: ${anchor.y}, scale: ${anchor.scale} },`,
        `  },`,
      ].join("\n")
    )
  }

  const out = `/**
 * The bot shapes a bot can wear.
 *
 * GENERATED FILE — do not hand-edit. Run \`node --experimental-strip-types
 * scripts/gen-openbot-bodies.ts\` (OpenBot's generator) to rebuild it.
 *
 * Every shape wears the OpenBot antennas; the tips are \`.omb-tip\` circles. The fields
 * match \`CursorSilhouette\`, so a body goes to the renderer with no adapter in between.
 */

import { z } from "zod";

/** Every selectable body id, in the order the picker shows them. */
export const MASCOT_BODY_IDS = [${SHAPES.map(s => quote(s.id)).join(", ")}] as const;

export type MascotBodyId = (typeof MASCOT_BODY_IDS)[number];

export const mascotBodySchema = z.enum(MASCOT_BODY_IDS);

export interface MascotBody {
  id: MascotBodyId;
  /** Human-readable name, used for the picker and the accessible label. */
  name: string;
  /** Transform mapping the outline into the face box. */
  fit: string;
  /** Body markup. \`{{GRADIENT}}\` is replaced with the bot's own gradient. */
  body: string;
  /** The head outline without a fill, used as the clip region. */
  clip: string;
  /** Where the face sits inside the body, in face-space units. */
  anchor: { x: number; y: number; scale: number };
}

/** The OpenBot robot, and the fallback for any unrecognised value. */
export const DEFAULT_MASCOT_BODY: MascotBodyId = "cursor";

export const MASCOT_BODIES: Record<MascotBodyId, MascotBody> = {
${entries.join("\n")}
};

/** Runtime-safe read of an untrusted persisted or streamed body id. */
export function botMascotBody(value: unknown): MascotBodyId {
  return mascotBodySchema.safeParse(value).data ?? DEFAULT_MASCOT_BODY;
}
`
  const target = process.argv[2] ?? fileURLToPath(new URL("../packages/phone-protocol/src/mascot-bodies.ts", import.meta.url))
  writeFileSync(target, out)
  console.log(`wrote ${target}`)
}

main()
