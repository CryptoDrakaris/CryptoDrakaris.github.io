#!/usr/bin/env node
// Palette and contrast check for charts, slides, graphics and mockups. Node 18+, no dependencies.
// Usage:
//   node palette-check.mjs "#hex,#hex,..." [--surface "#hex"] [--pairs adjacent|all] [--ordinal] [--json]
//   node palette-check.mjs "#text,#background"            # one text pair: WCAG contrast only
// Checks (rules palette-cvd, mark-contrast, color-by-job in charts.md):
//   - each color against the surface: WCAG ratio, needs >= 3:1 for marks (4.5:1 if used as text);
//   - colour difference between series as ΔE in OKLab ×100, normal vision >= 15,
//     simulated protanopia / deuteranopia / tritanopia >= 8 (6–8 warns: add labels or texture);
//   - --ordinal: lightness must change monotonically along the list.
// Colour science: OKLab (B. Ottosson, 2020); colour vision deficiency simulation with the
// severity-1.0 matrices of Machado, Oliveira, Fernandes (2009), applied in linear sRGB.
// Exit code: 0 clean, 1 at least one FAIL, 2 bad input.

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const list = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--surface' && args[args.indexOf(a) - 1] !== '--pairs');
if (!list) {
  console.error('Usage: node palette-check.mjs "#hex,#hex,..." [--surface "#hex"] [--pairs adjacent|all] [--ordinal] [--json]');
  process.exit(2);
}

const parseHex = (h) => {
  const m = h.trim().replace(/^#/, '');
  const full = m.length === 3 ? [...m].map((c) => c + c).join('') : m;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a hex colour: ${h}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
};
let colors, surface;
try {
  colors = list.split(',').map((h) => ({ hex: h.trim().toLowerCase(), rgb: parseHex(h) }));
  surface = opt('--surface') ? { hex: opt('--surface').toLowerCase(), rgb: parseHex(opt('--surface')) } : null;
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lin = (rgb) => rgb.map(toLinear);
const luminance = (rgb) => {
  const [r, g, b] = lin(rgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const wcag = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const oklab = ([r, g, b]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const clamp = (v) => Math.min(1, Math.max(0, v));
const simulate = (linRgb, m) => m.map((row) => clamp(row[0] * linRgb[0] + row[1] * linRgb[1] + row[2] * linRgb[2]));
const dE = (a, b) => 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const views = { normal: (c) => oklab(lin(c.rgb)) };
for (const [k, m] of Object.entries(MACHADO)) views[k] = (c) => oklab(simulate(lin(c.rgb), m));

const results = [];
const add = (level, rule, msg) => results.push({ level, rule, msg });

// one text/background pair
if (colors.length === 2 && !surface && !flag('--pairs')) {
  const r = wcag(colors[0].rgb, colors[1].rgb);
  add(r >= 4.5 ? 'OK' : r >= 3 ? 'WARN' : 'FAIL', 'contrast', `${colors[0].hex} on ${colors[1].hex}: ${r.toFixed(2)}:1 (text needs 4.5, large text and non-text 3)`);
} else {
  if (surface)
    for (const c of colors) {
      const r = wcag(c.rgb, surface.rgb);
      add(r >= 3 ? 'OK' : 'FAIL', 'mark-contrast', `${c.hex} on ${surface.hex}: ${r.toFixed(2)}:1${r < 4.5 && r >= 3 ? ' (enough for marks, not for text)' : ''}`);
    }
  const pairsMode = opt('--pairs', 'adjacent');
  const pairs = [];
  for (let i = 0; i < colors.length; i++)
    for (let j = i + 1; j < colors.length; j++) if (pairsMode === 'all' || j === i + 1) pairs.push([colors[i], colors[j]]);
  // an ordered scale is steps of one hue: neighbours are meant to be close, so only its
  // lightness order is checked below, not categorical distance
  for (const [a, b] of flag('--ordinal') ? [] : pairs) {
    const n = dE(views.normal(a), views.normal(b));
    if (n < 15) add('FAIL', 'palette-cvd', `${a.hex} / ${b.hex}: ΔE ${n.toFixed(1)} with normal vision (needs 15)`);
    for (const k of ['protan', 'deutan', 'tritan']) {
      const d = dE(views[k](a), views[k](b));
      const need = k === 'tritan' ? 6 : 8; // tritanopia is rare; warn earlier, fail later
      if (d < 6) add(k === 'tritan' ? 'WARN' : 'FAIL', 'palette-cvd', `${a.hex} / ${b.hex}: ΔE ${d.toFixed(1)} as ${k}opia (needs ${need})`);
      else if (d < need) add('WARN', 'palette-cvd', `${a.hex} / ${b.hex}: ΔE ${d.toFixed(1)} as ${k}opia – only with direct labels or texture`);
    }
  }
  if (pairsMode === 'all' && colors.length > 4) add('WARN', 'palette-cvd', `${colors.length} colours compared all-to-all: more than 3–4 series are rarely distinguishable on scatter plots and maps`);
  if (flag('--ordinal')) {
    const L = colors.map((c) => views.normal(c)[0]);
    const up = L.every((v, i) => i === 0 || v > L[i - 1]);
    const down = L.every((v, i) => i === 0 || v < L[i - 1]);
    add(up || down ? 'OK' : 'FAIL', 'color-by-job', `ordinal lightness ${L.map((v) => v.toFixed(2)).join(' → ')} ${up || down ? 'is monotonic' : 'is not monotonic: an ordered scale must go light to dark'}`);
  }
  if (!flag('--ordinal') && !results.some((r) => r.level !== 'OK')) add('OK', 'palette-cvd', `${pairs.length} pair(s) distinguishable in normal vision and simulated colour blindness`);
}

if (flag('--json')) console.log(JSON.stringify(results, null, 2));
else for (const r of results) console.log(`${r.level.padEnd(4)} ${r.rule.padEnd(14)} ${r.msg}`);
process.exit(results.some((r) => r.level === 'FAIL') ? 1 : 0);
