// Builds site copies from untouched originals and extracts an accent color per collection.
// grid: 600px static first frame (no autoplay in grids), full: 1600px, animation kept for GIFs.
// Writes public/derived/<contract>/<tokenId>-{grid,full}.webp and data/derived.json.
// Usage: npm run derive
import sharp from 'sharp';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const DERIVED = path.join(ROOT, 'public', 'derived');
const BG = { r: 11, g: 11, b: 13 }; // Drakaris shell background, accents must read on it

const exists = (p) => access(p).then(() => true, () => false);
const RASTER = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

const collection = JSON.parse(await readFile(path.join(DATA, 'collection.json'), 'utf8'));
let manifest = {};
try {
  manifest = JSON.parse(await readFile(path.join(DATA, 'derived.json'), 'utf8'));
} catch {}

// ---------- color helpers ----------
const lum = ({ r, g, b }) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}
function hslToRgb({ h, s, l }) {
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return { r: hue(p, q, h + 1 / 3) * 255, g: hue(p, q, h) * 255, b: hue(p, q, h - 1 / 3) * 255 };
}
const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Most saturated frequent color across images, lifted until it passes 4.5:1 on the dark shell. */
function pickAccent(samples) {
  if (!samples.length) return '#e8643c';
  // weight = saturation^2 * mid-lightness, so vivid colors beat gray/white backgrounds
  let best = samples[0], bestScore = -1;
  for (const c of samples) {
    const { s, l } = rgbToHsl(c);
    const score = s * s * (1 - Math.abs(l - 0.5) * 1.4);
    if (score > bestScore) (best = c), (bestScore = score);
  }
  const hsl = rgbToHsl(best);
  hsl.s = Math.max(hsl.s, 0.5);
  hsl.l = Math.min(Math.max(hsl.l, 0.45), 0.62);
  let rgb = hslToRgb(hsl);
  while (contrast(rgb, BG) < 4.5 && hsl.l < 0.9) {
    hsl.l += 0.02;
    rgb = hslToRgb(hsl);
  }
  return hex(rgb);
}

// ---------- main ----------
let made = 0, skipped = 0;
for (const group of collection.groups) {
  for (const col of group.members) {
    const contract = col.contract.toLowerCase();
    const outDir = path.join(DERIVED, contract);
    await mkdir(outDir, { recursive: true });
    const entry = (manifest[contract] ??= { tokens: {} });
    const samples = [];

    for (const t of col.tokens) {
      const file = t.originalFile;
      if (!file || !RASTER.test(file)) {
        skipped++;
        entry.tokens[t.tokenId] = { grid: false, full: false, kind: file ? path.extname(file).slice(1) : 'none' };
        continue;
      }
      const src = path.join(DATA, 'originals', contract, file);
      const gridOut = path.join(outDir, `${t.tokenId}-grid.webp`);
      const fullOut = path.join(outDir, `${t.tokenId}-full.webp`);
      const isGif = /\.gif$/i.test(file);
      const input = /\.svg$/i.test(file) ? { density: 300 } : {};
      try {
        if (!(await exists(gridOut)))
          await sharp(src, { ...input, animated: false }).resize({ width: 600, height: 600, fit: 'cover', withoutEnlargement: false }).webp({ quality: 86 }).toFile(gridOut);
        if (!(await exists(fullOut)))
          await sharp(src, { ...input, animated: isGif }).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 88 }).toFile(fullOut);
        const meta = await sharp(fullOut).metadata();
        entry.tokens[t.tokenId] = { grid: true, full: true, width: meta.width, height: meta.pageHeight ?? meta.height, animated: isGif };
        const { dominant } = await sharp(gridOut).stats();
        samples.push(dominant);
        // also sample a small palette so a flat background doesn't win every time
        const { data } = await sharp(gridOut).resize(4, 4, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
        for (let i = 0; i + 2 < data.length; i += 3) samples.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
        made++;
      } catch (e) {
        console.warn(`  ${col.name} #${t.tokenId}: ${e.message}`);
        entry.tokens[t.tokenId] = { grid: false, full: false, kind: 'error' };
      }
    }
    entry.accent = pickAccent(samples);
    console.log(`${col.name}: ${col.tokens.length} tokens, accent ${entry.accent}`);
  }
}

await writeFile(path.join(DATA, 'derived.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Done: ${made} images, ${skipped} non-raster skipped -> data/derived.json`);
