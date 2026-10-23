// Link preview for the home page: 1200×630 (1.91:1), the size social networks and messengers
// expect for og:image. The pinned token sits in the centre, so a square crop (avatars, some
// messengers) keeps it whole. No text on the image: SVG text would render in whatever font
// the build machine has.
// Writes public/og/home.jpg. Runs after derive-images.mjs (it needs the 1600px copy).
// Usage: node scripts/og-image.mjs
import sharp from 'sharp';
import { mkdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const W = 1200, H = 630;
const BG = '#0b0b0d', EMBER = '#ff6a3d'; // Drakaris shell background and accent

const pinned = JSON.parse(await readFile(path.join(ROOT, 'src/content/pinned.json'), 'utf8'));
const collection = JSON.parse(await readFile(path.join(ROOT, 'data/collection.json'), 'utf8'));
const col = collection.groups.flatMap((g) => g.collections ?? g.members ?? []).find((c) => c.slug === pinned.collection);
const token = col?.tokens.find((t) => String(t.tokenId) === pinned.tokenId);
const src = col && token && path.join(ROOT, 'public/derived', col.contract.toLowerCase(), `${token.tokenId}-full.webp`);
if (!src || !(await access(src).then(() => true, () => false))) {
  console.warn(`og-image: pinned ${pinned.collection} #${pinned.tokenId} has no 1600px copy, home falls back to the token image`);
  process.exit(0);
}

// art: a 540px card with a 6px ember frame, the frame colour filled under the art
// so its anti-aliased inner edge blends into the frame (see tilted-edges in the audit skill)
const ART = 540, FRAME = 6, RADIUS = 28;
const inner = ART - FRAME * 2;
const roundMask = (size, r) => Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`);
const art = await sharp(src).resize(inner, inner).composite([{ input: roundMask(inner, RADIUS - FRAME), blend: 'dest-in' }]).png().toBuffer();
const card = await sharp({ create: { width: ART, height: ART, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([
    { input: Buffer.from(`<svg width="${ART}" height="${ART}"><rect width="${ART}" height="${ART}" rx="${RADIUS}" fill="${EMBER}"/></svg>`) },
    { input: art, left: FRAME, top: FRAME },
  ])
  .png()
  .toBuffer();

// background: shell black with a soft ember glow behind the card
const bg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><radialGradient id="g" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="${EMBER}" stop-opacity="0.32"/><stop offset="1" stop-color="${EMBER}" stop-opacity="0"/></radialGradient></defs>
  <rect width="100%" height="100%" fill="${BG}"/><rect width="100%" height="100%" fill="url(#g)"/></svg>`);

await mkdir(path.join(ROOT, 'public/og'), { recursive: true });
const out = path.join(ROOT, 'public/og/home.jpg');
await sharp(bg)
  .composite([
    // shadow under the card
    { input: Buffer.from(`<svg width="${W}" height="${H}"><filter id="s"><feGaussianBlur stdDeviation="24"/></filter><rect x="${(W - ART) / 2}" y="${(H - ART) / 2 + 18}" width="${ART}" height="${ART}" rx="${RADIUS}" fill="#000" opacity="0.6" filter="url(#s)"/></svg>`) },
    { input: card, left: (W - ART) / 2, top: (H - ART) / 2 },
  ])
  .flatten({ background: BG })
  .jpeg({ quality: 88, mozjpeg: true })
  .toFile(out);
console.log(`og-image: ${pinned.collection} #${pinned.tokenId} -> public/og/home.jpg (${W}×${H})`);
