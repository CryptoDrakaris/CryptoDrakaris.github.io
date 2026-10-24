// Colour difference in CIE Lab: sRGB (D65) → CIE Lab → ΔE2000 (Sharma, Wu, Dalal 2005),
// and a CSS colour parser for the scripts that read colours from text (CSS, tokens, flags).
// Written from the published formulas; browser-checks.js carries the same code inline,
// because it runs as one expression in the page. No dependencies.

/** {r,g,b} in 0–255 → {L,a,b} (CIE Lab, D65). */
export function srgbToLab({ r, g, b }) {
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** Lab chroma: about 0 for greys, above ~15 for colours a viewer calls "coloured". */
export const chroma = ({ a, b }) => Math.hypot(a, b);

/** ΔE2000 between two Lab colours: < 1 invisible, < 3 the same colour to most viewers. */
export function deltaE2000(p, q) {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(p.a, p.b), C2 = Math.hypot(q.a, q.b);
  const Cm7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cm7 / (Cm7 + 25 ** 7)));
  const a1 = (1 + G) * p.a, a2 = (1 + G) * q.a;
  const c1 = Math.hypot(a1, p.b), c2 = Math.hypot(a2, q.b);
  const hue = (b, a) => (b === 0 && a === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const h1 = hue(p.b, a1), h2 = hue(q.b, a2);
  let dh = 0;
  if (c1 * c2) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dL = q.L - p.L, dC = c2 - c1, dH = 2 * Math.sqrt(c1 * c2) * Math.sin((dh / 2) * rad);
  const Lm = (p.L + q.L) / 2, cm = (c1 + c2) / 2;
  let hm = h1 + h2;
  if (c1 * c2) hm = Math.abs(h1 - h2) > 180 ? (hm < 360 ? hm + 360 : hm - 360) / 2 : hm / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const SC = 1 + 0.045 * cm, SH = 1 + 0.015 * cm * T;
  const RT = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

/** ΔE2000 between two sRGB colours {r,g,b}. */
export const deltaE = (x, y) => deltaE2000(srgbToLab(x), srgbToLab(y));

/**
 * Merge values used with a frequency: the most used value of a group stands for it.
 * items: [{key, count, ...}], near(a, b) → true when b belongs to a's group.
 * Returns [{key, count (whole group), members: [{key, count, ...}]}], most used first.
 */
export function mergeNear(items, near) {
  const groups = [];
  for (const it of [...items].sort((a, b) => b.count - a.count)) {
    const g = groups.find((x) => near(x.members[0], it));
    if (g) (g.members.push(it), (g.count += it.count));
    else groups.push({ key: it.key, count: it.count, members: [it] });
  }
  return groups.sort((a, b) => b.count - a.count);
}

// ---- CSS colour values ----
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0] };
const num = (s, scale = 1) => (s.endsWith('%') ? (parseFloat(s) / 100) * scale : parseFloat(s));
const hue = (s) => (s.endsWith('turn') ? parseFloat(s) * 360 : s.endsWith('rad') ? (parseFloat(s) * 180) / Math.PI : parseFloat(s));
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
}
function oklabToRgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((c) => 255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
}
/** CSS color → {r,g,b,a} or null: hex (with alpha), rgb(), hsl(), oklch(), oklab(), white/black/transparent. */
export function parseColor(v) {
  v = (v || '').trim().toLowerCase();
  if (NAMED[v]) return { r: NAMED[v][0], g: NAMED[v][1], b: NAMED[v][2], a: NAMED[v][3] };
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 5 || h.length === 7) return null;
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = v.match(/^(rgba?|hsla?|oklch|oklab)\(([^()]*)\)$/);
  if (!m) return null;
  const parts = m[2].replace(/,/g, ' ').replace('/', ' / ').split(/\s+/).filter(Boolean);
  const slash = parts.indexOf('/');
  const ch = slash >= 0 ? parts.slice(0, slash) : parts.slice(0, 3);
  const alphaRaw = slash >= 0 ? parts[slash + 1] : parts[3];
  if (ch.length < 3 || ch.some((p) => p === 'none' || isNaN(parseFloat(p)))) return null;
  const a = alphaRaw === undefined ? 1 : num(alphaRaw);
  let rgb;
  if (m[1].startsWith('rgb')) rgb = ch.map((p) => num(p, 255));
  else if (m[1].startsWith('hsl')) rgb = hslToRgb(hue(ch[0]), num(ch[1].endsWith('%') ? ch[1] : ch[1] + '%'), num(ch[2].endsWith('%') ? ch[2] : ch[2] + '%'));
  else if (m[1] === 'oklch') {
    const L = num(ch[0]), C = num(ch[1], 0.4), H = (hue(ch[2]) * Math.PI) / 180;
    rgb = oklabToRgb(L, C * Math.cos(H), C * Math.sin(H));
  } else rgb = oklabToRgb(num(ch[0]), num(ch[1], 0.4), num(ch[2], 0.4));
  return { r: rgb[0], g: rgb[1], b: rgb[2], a: Math.min(1, Math.max(0, a)) };
}

/** {r,g,b} → #rrggbb */
export const toHex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
