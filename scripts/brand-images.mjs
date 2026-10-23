// Brand images from the pinned token (src/content/pinned.json), built from its 1600px copy,
// so this runs after derive-images.mjs.
// - Link preview for the home page: 1200×630 (1.91:1), the size social networks and messengers
//   expect for og:image. The token sits in the centre, so a square crop (avatars, some
//   messengers) keeps it whole. No text: SVG text would render in the build machine's fonts.
// - Favicons: rendered from public/favicon.svg (the owner's "D" for Drakaris), so the .ico,
//   PNG and home screen icon match the SVG tab icon. The lion's head was tried and dropped.
// Writes public/og/home.jpg, public/favicon.ico, public/apple-touch-icon.png.
// Usage: node scripts/brand-images.mjs
import sharp from 'sharp';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
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
  console.warn(`brand-images: pinned ${pinned.collection} #${pinned.tokenId} has no 1600px copy, home falls back to the token image`);
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
console.log(`brand-images: ${pinned.collection} #${pinned.tokenId} -> public/og/home.jpg (${W}×${H})`);

// ---------- favicons ----------
const svgIcon = await readFile(path.join(ROOT, 'public/favicon.svg'));
const tab = (px) => sharp(svgIcon, { density: Math.ceil((72 * px) / 64) * 4 }).resize(px, px).png().toBuffer();
const png32 = await tab(32);
const png48 = await tab(48);


// .ico for browsers and crawlers that ask for /favicon.ico: an ICO directory holding PNG images
const ico = (images) => {
  const dir = Buffer.alloc(6 + 16 * images.length);
  dir.writeUInt16LE(1, 2); // type: icon
  dir.writeUInt16LE(images.length, 4);
  let offset = dir.length;
  images.forEach(({ px, data }, i) => {
    const e = 6 + 16 * i;
    dir[e] = px;
    dir[e + 1] = px;
    dir.writeUInt16LE(1, e + 4); // colour planes
    dir.writeUInt16LE(32, e + 6); // bits per pixel
    dir.writeUInt32LE(data.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([dir, ...images.map((i) => i.data)]);
};
await writeFile(path.join(ROOT, 'public/favicon.ico'), ico([{ px: 32, data: png32 }, { px: 48, data: png48 }]));

// home screen icon: iOS rounds it itself and paints transparency black, so square and opaque
await sharp(svgIcon, { density: 864 }).resize(180, 180).flatten({ background: '#080a0c' }).png().toFile(path.join(ROOT, 'public/apple-touch-icon.png'));
console.log('brand-images: favicons from public/favicon.svg -> favicon.ico, apple-touch-icon.png');

