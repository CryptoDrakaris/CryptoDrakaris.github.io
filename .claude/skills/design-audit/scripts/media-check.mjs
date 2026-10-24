#!/usr/bin/env node
// Image, icon, SVG and GIF check by file headers. Node 18+, no dependencies.
// Usage: node media-check.mjs <file|folder>... [--purpose og|social|favicon|icon|print|gif-grid|gif-chat|lottie] [--canon <colours|tokens.json|tokens.css>] [--json]
// --canon: the main colours of a PNG (pixels clustered by ΔE2000) against the brand canon –
// visual-palette-drift in graphics.md; "#hex:0.4" or a JSON token with "share" sets the intended part.
// Rules: graphics.md (og-image-spec, gfx-resolution, gfx-format, favicon-set, svg-hygiene,
// svg-accessible, gfx-color-profile) and media.md (gif-budget, gif-fps, gif-palette, gif-loop-intent);
// `format` – the file is empty or cannot be read.
// Reads PNG, JPEG, GIF, WebP, AVIF/HEIC (size only) and SVG; 3D models .glb/.gltf (web.md:
// gl-model-compression, gl-texture-vram, gl-model-valid as a structure check only); Lottie .json and
// dotLottie .lottie (media.md: lottie-*), by the format's own fields. Video is not parsed. Flashes per
// frame are not detected here: check flash-threshold by eye.
// Levels: FAIL, WARN, INFO and N/A – a rule of the chosen --purpose that does not apply to this
// file (a still image for gif-*, a vector for print): N/A is not a pass.
// Exit code: 0 no FAIL, 1 at least one FAIL, 2 bad input.
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { unzip } from './zip.mjs';
import { decodePng } from './png-decode.mjs';
import { loadCanon } from './canon.mjs';
import { srgbToLab, deltaE2000, mergeNear, toHex } from './color-delta.mjs';

const PURPOSES = ['og', 'social', 'favicon', 'icon', 'print', 'gif-grid', 'gif-chat', 'lottie'];
const USAGE = `Usage: node media-check.mjs <file|folder>... [--purpose ${PURPOSES.join('|')}] [--canon <colours|tokens.json|tokens.css>] [--json]`;
const fail = (msg) => {
  console.error(`Error: ${msg}\n${USAGE}`);
  process.exit(2);
};
const args = process.argv.slice(2);
let purpose, asJson = false, canonSpec = null;
const inputs = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--json') asJson = true;
  else if (a === '--purpose' || a.startsWith('--purpose=')) {
    purpose = a.includes('=') ? a.split('=')[1] : args[++i];
    if (!PURPOSES.includes(purpose)) fail(`unknown --purpose ${purpose ?? '(missing)'}`);
  } else if (a === '--canon' || a.startsWith('--canon=')) {
    canonSpec = a.includes('=') ? a.slice(8) : args[++i];
    if (!canonSpec || canonSpec.startsWith('--')) fail('--canon needs colours or a tokens file');
  } else if (a === '--help' || a === '-h') {
    console.log(USAGE);
    process.exit(0);
  } else if (a.startsWith('-')) fail(`unknown option ${a}`);
  else inputs.push(a);
}
if (!inputs.length) fail('no files given');
let canon = null;
if (canonSpec)
  try {
    canon = (await loadCanon(canonSpec)).map((t) => ({ ...t, lab: srgbToLab(t.rgb) }));
  } catch (e) {
    fail(`--canon: ${e.message}`);
  }

// Main colours of a picture: opaque pixels (up to ~200k sampled) in 4-bit-per-channel buckets,
// buckets merged when closer than ΔE2000 3; a main colour holds at least 2% of the pixels.
function mainColors(img) {
  const { width, height, data } = img;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 200000)));
  const buckets = new Map();
  let total = 0;
  for (let y = 0; y < height; y += step)
    for (let x = 0; x < width; x += step) {
      const o = (y * width + x) * 4;
      if (data[o + 3] < 128) continue;
      const k = ((data[o] >> 4) << 8) | ((data[o + 1] >> 4) << 4) | (data[o + 2] >> 4);
      const e = buckets.get(k) || { r: 0, g: 0, b: 0, count: 0 };
      e.r += data[o];
      e.g += data[o + 1];
      e.b += data[o + 2];
      e.count++;
      buckets.set(k, e);
      total++;
    }
  const items = [...buckets.values()].map((e) => {
    const rgb = { r: e.r / e.count, g: e.g / e.count, b: e.b / e.count };
    return { key: toHex(rgb), count: e.count, rgb, lab: srgbToLab(rgb) };
  });
  const groups = mergeNear(items, (a, b) => deltaE2000(a.lab, b.lab) < 3);
  return { total, colors: groups.map((g) => ({ hex: g.key, lab: g.members[0].lab, share: g.count / Math.max(1, total) })) };
}
// in a folder, .json files are taken only for --purpose lottie: most JSON is not animation
const EXT = /\.(png|jpe?g|gif|webp|avif|heic|svg|glb|gltf|lottie)$/i;
// flatMap passes the index as the second argument: named files are always taken
const files = inputs.flatMap((p) => walk(p, true));
function walk(p, top) {
  let s;
  try {
    s = statSync(p);
  } catch {
    fail(`${p} does not exist`);
  }
  if (s.isDirectory()) return readdirSync(p).filter((f) => !f.startsWith('.')).flatMap((f) => walk(join(p, f), false));
  return top || EXT.test(p) || (purpose === 'lottie' && /\.json$/i.test(p)) ? [p] : [];
}

// ---------- header parsers ----------
function png(b) {
  const info = { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25], animated: false };
  info.alpha = [4, 6].includes(info.colorType);
  for (let o = 8; o + 8 <= b.length; ) {
    const len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8);
    if (type === 'tRNS') info.alpha = true;
    if (type === 'acTL') (info.animated = true), (info.frames = b.readUInt32BE(o + 8));
    if (type === 'iCCP') info.iccProfile = b.toString('latin1', o + 8, b.indexOf(0, o + 8));
    if (type === 'pHYs' && b[o + 16] === 1) info.dpi = Math.round(b.readUInt32BE(o + 8) * 0.0254);
    if (type === 'IEND') break;
    o += 12 + len;
  }
  return info;
}
function jpeg(b) {
  const info = { format: 'jpeg', alpha: false };
  for (let o = 2; o + 4 < b.length; ) {
    if (b[o] !== 0xff) break;
    const marker = b[o + 1], len = b.readUInt16BE(o + 2);
    if (marker === 0xe0 && b.toString('latin1', o + 4, o + 9) === 'JFIF\0' && b[o + 11] === 1) info.dpi = b.readUInt16BE(o + 12);
    if (marker === 0xe2 && b.toString('latin1', o + 4, o + 15) === 'ICC_PROFILE') info.iccProfile = 'embedded';
    // Adobe APP14 is written by Photoshop for RGB files too: only 4 components mean CMYK/YCCK
    if (marker === 0xee && b.toString('latin1', o + 4, o + 9) === 'Adobe') info.adobeTransform = b[o + 15];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      info.height = b.readUInt16BE(o + 5);
      info.width = b.readUInt16BE(o + 7);
      info.components = b[o + 9];
      if (info.components === 4) info.cmyk = true;
      break;
    }
    o += 2 + len;
  }
  return info;
}
function gif(b) {
  const info = { format: 'gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8), frames: 0, delays: [], loop: null, localPalettes: 0, alpha: false };
  const packed = b[10];
  let o = 13;
  if (packed & 0x80) {
    info.globalPalette = 2 ** ((packed & 7) + 1);
    o += 3 * info.globalPalette;
  }
  const skipBlocks = () => {
    while (o < b.length && b[o] !== 0) o += b[o] + 1;
    o++;
  };
  while (o < b.length) {
    const id = b[o];
    if (id === 0x3b) break; // trailer
    if (id === 0x21) {
      const label = b[o + 1];
      if (label === 0xf9) {
        info.delays.push(b.readUInt16LE(o + 4) * 10); // centiseconds -> ms
        if (b[o + 3] & 1) info.alpha = true;
      }
      if (label === 0xff && b.toString('latin1', o + 3, o + 14) === 'NETSCAPE2.0') info.loop = b.readUInt16LE(o + 16); // 0 = forever
      o += 2;
      skipBlocks();
    } else if (id === 0x2c) {
      info.frames++;
      const p = b[o + 9];
      o += 10;
      if (p & 0x80) (info.localPalettes++, (o += 3 * 2 ** ((p & 7) + 1)));
      o++; // LZW minimum code size
      skipBlocks();
    } else break;
  }
  info.animated = info.frames > 1;
  if (info.delays.length) {
    // browsers play delays of 0 and 10 ms as 100 ms
    info.durationMs = info.delays.reduce((a, d) => a + (d <= 10 ? 100 : d), 0);
    info.fps = +(info.frames / (info.durationMs / 1000)).toFixed(1);
  }
  return info;
}
function webp(b) {
  const info = { format: 'webp', alpha: false, animated: false };
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8X') {
    const f = b[20];
    info.alpha = !!(f & 0x10);
    info.animated = !!(f & 0x02);
    info.width = 1 + b.readUIntLE(24, 3);
    info.height = 1 + b.readUIntLE(27, 3);
  } else if (chunk === 'VP8 ') (info.width = b.readUInt16LE(26) & 0x3fff), (info.height = b.readUInt16LE(28) & 0x3fff);
  else if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    info.width = 1 + (bits & 0x3fff);
    info.height = 1 + ((bits >> 14) & 0x3fff);
    info.alpha = !!((bits >> 28) & 1);
  }
  if (info.animated) info.frames = (b.toString('latin1').match(/ANMF/g) || []).length;
  return info;
}
function isobmff(b) {
  const brand = b.toString('latin1', 8, 12);
  const info = { format: /avi[fs]/.test(brand) ? 'avif' : 'heic' };
  const i = b.indexOf('ispe');
  if (i > 0) (info.width = b.readUInt32BE(i + 8)), (info.height = b.readUInt32BE(i + 12));
  return info;
}
// glTF 2.0: binary .glb (12-byte header, JSON chunk, BIN chunk) or .gltf JSON. Embedded
// textures are measured with the image parsers above; external ones by their own file.
function gltf(b, isText, dir) {
  let json, bin = null;
  if (isText) json = JSON.parse(b.toString('utf8'));
  else {
    if (b.readUInt32LE(4) !== 2) throw new Error(`glTF version ${b.readUInt32LE(4)}, expected 2`);
    let o = 12;
    while (o + 8 <= b.length) {
      const len = b.readUInt32LE(o), type = b.readUInt32LE(o + 4);
      if (type === 0x4e4f534a) json = JSON.parse(b.toString('utf8', o + 8, o + 8 + len));
      if (type === 0x004e4942) bin = b.subarray(o + 8, o + 8 + len);
      o += 8 + len;
    }
    if (!json) throw new Error('no JSON chunk');
  }
  const used = json.extensionsUsed || [];
  const info = { format: isText ? 'gltf' : 'glb', version: json.asset?.version ?? null, meshes: (json.meshes || []).length, primitives: (json.meshes || []).reduce((n, m) => n + (m.primitives || []).length, 0), extensions: used, textures: [] };
  info.meshCompression = used.find((e) => /KHR_draco_mesh_compression|EXT_meshopt_compression|KHR_meshopt_compression/.test(e)) || null;
  info.textureCompression = used.find((e) => /KHR_texture_basisu|EXT_texture_webp|EXT_texture_avif/.test(e)) || null;
  for (const [i, im] of (json.images || []).entries()) {
    let data = null;
    if (im.bufferView !== undefined && bin) {
      const v = json.bufferViews[im.bufferView];
      data = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    } else if (/^data:/.test(im.uri || '')) data = Buffer.from(im.uri.split(',')[1], 'base64');
    else if (im.uri) {
      try {
        data = readFileSync(join(dir, decodeURIComponent(im.uri)));
      } catch {}
    }
    const t = { name: im.name || im.uri || `image ${i}`, mime: im.mimeType || (im.uri || '').split('.').pop() };
    if (data?.length >= 24 && data.readUInt32BE(0) === 0x89504e47) Object.assign(t, { width: data.readUInt32BE(16), height: data.readUInt32BE(20) });
    else if (data && data[0] === 0xff && data[1] === 0xd8) {
      const j = jpeg(data);
      Object.assign(t, { width: j.width, height: j.height });
    }
    info.textures.push(t);
  }
  return info;
}
// Lottie (Bodymovin JSON): w, h, fr, ip, op, layers, assets (images and precomps), fonts.
function lottie(json, extra = {}) {
  const need = ['w', 'h', 'fr', 'ip', 'op', 'layers'].filter((k) => json[k] === undefined);
  if (need.length) return { format: 'unknown', error: `JSON without Lottie fields ${need.join(', ')}` };
  const assets = json.assets || [];
  const layerLists = [json.layers, ...assets.filter((a) => Array.isArray(a.layers)).map((a) => a.layers)];
  const layers = layerLists.flat();
  let expressions = 0;
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.x === 'string' && 'k' in o) expressions++;
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
  };
  walk(layerLists);
  const images = assets.filter((a) => a.p !== undefined && !a.layers);
  const embedded = images.filter((a) => a.e === 1 || /^data:/.test(a.p || ''));
  const fonts = json.fonts?.list || [];
  return {
    format: 'lottie',
    version: json.v ?? null,
    width: json.w,
    height: json.h,
    fps: json.fr,
    frames: json.op - json.ip,
    durationMs: json.fr > 0 ? Math.round(((json.op - json.ip) / json.fr) * 1000) : 0,
    animated: true,
    layers: layers.length,
    precomps: layerLists.length - 1,
    expressions,
    effects: layers.filter((l) => Array.isArray(l.ef) && l.ef.length).length,
    textLayers: layers.filter((l) => l.ty === 5).length,
    glyphs: (json.chars || []).length,
    localFonts: fonts.filter((f) => !f.fPath && (f.origin === undefined || f.origin === 0)).map((f) => f.fFamily || f.fName),
    images: images.length,
    embeddedImages: embedded.length,
    embeddedKB: Math.round(embedded.reduce((s, a) => s + ((a.p || '').length * 3) / 4, 0) / 1024),
    ...extra,
  };
}
// dotLottie: a zip with manifest.json and the animations as JSON (animations/ in v1, a/ in v2)
function dotLottie(b) {
  const z = unzip(b);
  const manifest = z.has('manifest.json') ? JSON.parse(z.get('manifest.json')().toString('utf8')) : null;
  const anims = [...z.keys()].filter((n) => /^(animations|a)\/[^/]+\.json$/.test(n));
  if (!anims.length) return { format: 'unreadable', error: 'dotLottie without animations/*.json' };
  const first = manifest?.animations?.[0] || {};
  const name = anims.find((n) => first.id && n.endsWith(`/${first.id}.json`)) || anims[0];
  const packedImages = [...z.keys()].filter((n) => /^(images|i)\/[^/]+$/.test(n)).length;
  const info = lottie(JSON.parse(z.get(name)().toString('utf8')), { container: 'dotlottie', animationsInFile: anims.length, packedImages, loop: first.loop ?? null, autoplay: first.autoplay ?? null });
  if (info.format === 'lottie' && packedImages) info.embeddedImages += packedImages;
  return info;
}
function svg(text) {
  const info = { format: 'svg', vector: true };
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  const root = text.match(/<svg\b[^>]*>/i)?.[0] || '';
  const attr = (n) => root.match(new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
  // width="100%" is not a size: the viewBox gives the proportions
  const len = (n) => (/%\s*$/.test(attr(n) || '') ? undefined : parseFloat(attr(n)) || undefined);
  info.viewBox = attr('viewBox');
  info.width = len('width') ?? (info.viewBox ? +info.viewBox.split(/[\s,]+/)[2] : undefined);
  info.height = len('height') ?? (info.viewBox ? +info.viewBox.split(/[\s,]+/)[3] : undefined);
  info.fixedSize = !!(len('width') || len('height'));
  info.embeddedRaster = (text.match(/<image\b[^>]*href\s*=\s*["']data:image/gi) || []).length;
  // resources the SVG loads; an <a href> is a link to follow, not a request
  info.externalRefs = (text.match(/<(?:image|use|feImage|script|link|font-face-uri)\b[^>]*(?:xlink:)?href\s*=\s*["']https?:/gi) || []).length + (text.match(/@import|url\(\s*['"]?https?:/gi) || []).length;
  info.externalLinks = (text.match(/<a\b[^>]*href\s*=\s*["']https?:/gi) || []).length;
  info.textNodes = (text.match(/<text\b/gi) || []).length;
  info.fonts = [...new Set((text.match(/font-family\s*[:=]\s*["']?([^;"'>]+)/gi) || []).map((m) => m.replace(/font-family\s*[:=]\s*["']?/i, '').trim()))];
  info.title = /<title\b/i.test(text);
  info.roleImg = /role\s*=\s*["']img["']/i.test(root);
  info.ariaHidden = /aria-hidden\s*=\s*["']true["']/i.test(root);
  info.currentColor = /currentColor/.test(text);
  info.hardcodedFills = (text.match(/fill\s*[:=]\s*["']?#[0-9a-f]{3,8}/gi) || []).length;
  info.scripts = /<script\b|\son\w+\s*=/i.test(text);
  info.editorJunk = /inkscape:|sodipodi:|sketch:|data-name=|<metadata\b/i.test(text);
  return info;
}

// ---------- purposes ----------
const PURPOSE = {
  og: { w: 1200, h: 630, ratio: 1.91, maxKB: 5120, formats: ['png', 'jpeg'], partly: ['webp'] },
  social: { minW: 1080, maxKB: 8192 },
  favicon: { square: true, minW: 32, maxKB: 100 },
  icon: { square: true, maxKB: 50 },
  print: { minDpi: 300 },
  'gif-grid': { maxKB: 300, note: 'grids show a static first frame; animation belongs on the item page' },
  'gif-chat': { maxKB: 256, maxW: 512 },
};

const report = [];
for (const f of files) {
  const b = readFileSync(f);
  const kb = Math.round(b.length / 1024);
  const ext = extname(f).slice(1).toLowerCase().replace('jpg', 'jpeg');
  let info;
  try {
    const head = b.toString('latin1', 0, 12);
    if (!b.length) info = { format: 'unreadable', error: 'empty file' };
    else if (b.length >= 4 && b.readUInt32BE(0) === 0x89504e47) info = png(b);
    else if (b[0] === 0xff && b[1] === 0xd8) info = jpeg(b);
    else if (head.startsWith('GIF8')) info = gif(b);
    else if (head.startsWith('RIFF') && head.slice(8) === 'WEBP') info = webp(b);
    else if (head.slice(4, 8) === 'ftyp') info = isobmff(b);
    else if (head.startsWith('glTF')) info = gltf(b, false, dirname(f));
    else if (ext === 'lottie') info = dotLottie(b);
    else if (ext === 'json') info = lottie(JSON.parse(b.toString('utf8')));
    else if (ext === 'gltf') info = gltf(b, true, dirname(f));
    // an SVG may open with a long comment, a doctype or an XML declaration
    else if (/<svg\b/i.test(b.toString('utf8', 0, Math.min(b.length, ext === 'svg' ? b.length : 262144)))) info = svg(b.toString('utf8'));
    else info = { format: 'unknown' };
    if (!['svg', 'glb', 'gltf', 'lottie', 'unknown', 'unreadable'].includes(info.format) && !info.width) info = { format: 'unreadable', error: `damaged ${info.format}: no image size in the header` };
  } catch (e) {
    info = { format: 'unreadable', error: /out of range|beyond buffer/i.test(e.message) ? 'file is cut short' : e.message };
  }
  const issues = [];
  const add = (level, rule, msg) => issues.push({ level, rule, msg });
  if (info.format === 'unreadable') add('FAIL', 'format', `${info.error}: not a usable image`);
  if (info.format === 'unknown') add('WARN', 'format', info.error || 'not a recognised image format');
  if (!['unknown', 'unreadable'].includes(info.format) && ext && ext !== info.format && !(ext === 'heic' && info.format === 'avif') && info.format !== 'lottie') add('WARN', 'gfx-format', `extension .${ext} but content is ${info.format}`);
  // svg
  if (info.format === 'svg') {
    if (!info.viewBox) add('FAIL', 'svg-hygiene', 'no viewBox: the icon will not scale cleanly');
    if (info.embeddedRaster) add('WARN', 'svg-hygiene', `${info.embeddedRaster} embedded raster image(s): heavy and blurry when scaled`);
    if (info.externalRefs) add('FAIL', 'svg-hygiene', `${info.externalRefs} external resource(s): breaks offline and leaks requests`);
    if (info.externalLinks) add('INFO', 'svg-hygiene', `${info.externalLinks} link(s) inside: they work only when the SVG is inlined or opened directly, not as <img>`);
    if (info.scripts) add('FAIL', 'svg-hygiene', 'script or on* handler inside the SVG');
    if (info.textNodes && info.fonts.length) add('WARN', 'svg-hygiene', `live text in fonts ${info.fonts.join(', ')}: renders in a fallback font where they are missing; outline the text or ship the font`);
    if (info.editorJunk) add('INFO', 'svg-hygiene', 'editor metadata left in the file (Inkscape/Sketch/Figma): optimise with SVGO');
    if (!info.title && !info.ariaHidden) add('INFO', 'svg-accessible', 'no <title> and no aria-hidden: give meaning when inlined, or mark decorative');
    if (purpose === 'icon' && info.hardcodedFills && !info.currentColor) add('INFO', 'svg-hygiene', 'colours are hard-coded: use currentColor if the icon must follow text colour');
  }
  // gif / animation
  if (info.format === 'gif') {
    if (info.fps && (info.fps < 10 || info.fps > 30)) add('WARN', 'gif-fps', `${info.fps} fps (10–30 recommended)`);
    if (info.delays?.some((d) => d <= 10)) add('WARN', 'gif-fps', 'frames with 0 or 10 ms delay: browsers play them at ~100 ms, timing will differ');
    if (info.localPalettes > 1) add('WARN', 'gif-palette', `${info.localPalettes} frames carry their own palette: flicker and weight, use one global palette`);
    if (info.globalPalette && info.globalPalette > 128 && info.frames > 1) add('INFO', 'gif-palette', `global palette of ${info.globalPalette} colours: 48–128 is usually enough`);
    if (info.animated && info.loop === null) add('INFO', 'gif-loop-intent', 'plays once (no loop extension): make sure the last frame is the intended end state');
    if (kb > 2048) add('WARN', 'gif-budget', `${kb} KB: a looping video (MP4/WebM) would be 5–10× lighter`);
  }
  // visual-palette-drift: main colours of the picture against the canon
  if (canon && !['unknown', 'unreadable'].includes(info.format)) {
    if (info.format !== 'png') add('N/A', 'visual-palette-drift', `colours are measured in PNG only (this is ${info.format}): export a PNG of the same picture`);
    else
      try {
        const { total, colors } = mainColors(decodePng(b));
        const main = colors.filter((c) => c.share >= 0.02);
        if (!total || !main.length) add('N/A', 'visual-palette-drift', 'no opaque area large enough to measure');
        else {
          const sum = main.reduce((s, c) => s + c.share, 0);
          for (const c of main) {
            const n = canon.map((t) => ({ t, d: deltaE2000(c.lab, t.lab) })).sort((p, q) => p.d - q.d)[0];
            Object.assign(c, { nearest: n.t, d: n.d });
          }
          const mean = main.reduce((s, c) => s + c.d * c.share, 0) / sum;
          info.palette = { mainColors: main.slice(0, 12).map((c) => `${c.hex} ${(c.share * 100).toFixed(0)}% → ${c.nearest.name} ${c.nearest.hex} ΔE ${c.d.toFixed(1)}`), meanDeltaE: +mean.toFixed(1) };
          const off = main.filter((c) => c.d > 5);
          if (mean > 5) add('WARN', 'visual-palette-drift', `main colours are ΔE ${mean.toFixed(1)} from the canon on average (≤ 5)`);
          for (const c of off.filter((c) => c.d > 20)) add('WARN', 'visual-palette-drift', `${c.hex} covers ${(c.share * 100).toFixed(0)}% and is not a canon colour (ΔE ${c.d.toFixed(0)} to ${c.nearest.name})`);
          for (const t of canon.filter((t) => t.share !== undefined)) {
            const got = main.filter((c) => c.nearest === t && c.d <= 10).reduce((s, c) => s + c.share, 0);
            if (Math.abs(got - t.share) > 0.35) add('WARN', 'visual-palette-drift', `${t.name} ${t.hex} covers ${(got * 100).toFixed(0)}% of the picture, intended ${(t.share * 100).toFixed(0)}%`);
          }
          if (mean <= 5 && !off.some((c) => c.d > 20)) add('INFO', 'visual-palette-drift', `main colours within the canon: mean ΔE ${mean.toFixed(1)}`);
        }
      } catch (e) {
        add('INFO', 'visual-palette-drift', `colours not measured: ${e.message}`);
      }
  }
  // Lottie: frame rate, length, raster inside, expressions, effects, fonts, layers, weight
  if (info.format === 'lottie') {
    if (!(info.fps > 0) || info.frames <= 0) add('FAIL', 'format', `fr ${info.fps}, ip–op ${info.frames} frames: the animation has no length`);
    else {
      if (info.fps < 15 || info.fps > 60) add('WARN', 'lottie-fps', `${info.fps} fps: below 15 looks jerky, above 60 costs CPU for nothing (24–60)`);
      if (info.durationMs > 5000) add(info.loop && info.autoplay ? 'WARN' : 'INFO', 'lottie-duration', `${(info.durationMs / 1000).toFixed(1)} s${info.loop && info.autoplay ? ', autoplay and loop' : ''}: moving longer than 5 s on a page needs a pause control (media-autoplay-controls)`);
    }
    if (info.embeddedImages) add('WARN', 'lottie-raster', `${info.embeddedImages} raster image(s) inside${info.embeddedKB ? ` (${info.embeddedKB} KB as base64)` : ''}: heavy, blurry when scaled; redraw as shapes or ship a video`);
    else if (info.images) add('INFO', 'lottie-raster', `${info.images} external image(s): they must be served next to the JSON and are extra requests`);
    if (info.expressions) add('WARN', 'lottie-expressions', `${info.expressions} expression(s): slow, and native players (iOS, Android, Skottie, dotLottie) support them partly or not at all`);
    if (info.effects) add('INFO', 'lottie-expressions', `${info.effects} layer(s) with effects (ef): most players outside the web ignore them`);
    if (info.textLayers && !info.glyphs && info.localFonts.length) add('WARN', 'lottie-fonts', `${info.textLayers} text layer(s) in fonts ${info.localFonts.join(', ')} that must be installed: convert text to shapes or give fPath`);
    if (info.layers > 150) add('WARN', 'lottie-complexity', `${info.layers} layers (with precomps): frame drops on phones; flatten or simplify`);
    if (info.width * info.height > 2000 * 2000) add('INFO', 'lottie-complexity', `canvas ${info.width}×${info.height}: rendered at its own size, scaled down after`);
    if (kb > 500) add('WARN', 'lottie-weight', `${kb} KB: UI animations ≲ 100 KB, illustrations ≲ 500 KB; dotLottie compresses JSON several times`);
    else if (kb > 150 && info.container !== 'dotlottie') add('INFO', 'lottie-weight', `${kb} KB of JSON: a .lottie (zip) would be several times smaller`);
  } else if (purpose === 'lottie' && !['unknown', 'unreadable'].includes(info.format)) add('N/A', 'lottie-fps', `--purpose lottie on a ${info.format} file: Lottie rules do not apply`);
  // 3D models: weight, mesh and texture compression, texture sizes in video memory
  if (info.format === 'glb' || info.format === 'gltf') {
    if (info.version !== '2.0') add('FAIL', 'gl-model-valid', `asset.version ${info.version ?? 'missing'}: not a glTF 2.0 model`);
    else add('INFO', 'gl-model-valid', 'structure read; full validation – the Khronos glTF-Validator');
    if (!info.meshCompression && kb > 1024) add('WARN', 'gl-model-compression', `${kb} KB without Draco or meshopt: geometry usually shrinks several times`);
    if (kb > 5 * 1024) add('WARN', 'gl-model-compression', `${(kb / 1024).toFixed(1)} MB: heavy for a page, budget the model with the rest of the page weight`);
    const big = info.textures.filter((t) => t.width && Math.max(t.width, t.height) > 2048);
    const vram = info.textures.reduce((s, t) => s + (t.width ? (t.width * t.height * 4 * 4) / 3 : 0), 0) / 1048576; // RGBA + mipmaps
    for (const t of big) add('WARN', 'gl-texture-vram', `texture ${t.name} ${t.width}×${t.height}: ≈${((t.width * t.height * 16) / 3 / 1048576).toFixed(0)} MB of video memory; phones need 2048 or less`);
    if (info.textures.length && !info.textureCompression && info.textures.some((t) => /png|jpe?g/i.test(t.mime))) add('INFO', 'gl-model-compression', `${info.textures.length} PNG/JPEG texture(s) without KTX2/WebP/AVIF: they unpack to full size in video memory`);
    if (vram) info.textureVramMB = +vram.toFixed(1);
    if (!info.textures.length) add('N/A', 'gl-texture-vram', 'no textures in the model');
  }
  if (info.cmyk) add('WARN', 'gfx-color-profile', 'CMYK JPEG: colours shift on screens and some browsers, export in sRGB');
  if (info.iccProfile && !/srgb/i.test(info.iccProfile) && info.iccProfile !== 'embedded') add('INFO', 'gfx-color-profile', `colour profile "${info.iccProfile}": use sRGB for screens`);
  // purpose
  const p = PURPOSE[purpose];
  const readable = !['unknown', 'unreadable'].includes(info.format);
  if (readable && purpose?.startsWith('gif') && !info.animated) add('N/A', 'gif-fps', `--purpose ${purpose} on a still image: frame rate, loop and duration do not apply`);
  if (readable && info.animated && !['gif', 'lottie'].includes(info.format)) add('INFO', 'gif-fps', `animated ${info.format}: frame timing and palette are not measured (GIF only), check them in an editor`);
  if (readable && purpose === 'print' && info.format === 'svg') add('N/A', 'gfx-resolution', 'vector: no pixel size, prints sharp at any size (check embedded rasters)');
  if (p) {
    if (p.maxKB && kb > p.maxKB) add('FAIL', purpose.startsWith('gif') ? 'gif-budget' : 'gfx-resolution', `${kb} KB, budget for ${purpose} is ${p.maxKB} KB${p.note ? ` (${p.note})` : ''}`);
    if (p.formats && !p.formats.includes(info.format) && info.format !== 'unreadable')
      add(p.partly?.includes(info.format) ? 'WARN' : 'FAIL', 'og-image-spec', `${info.format} is not supported by link previews everywhere (use ${p.formats.join('/')})`);
    if (p.w && info.width && (info.width !== p.w || info.height !== p.h)) {
      const r = info.width / info.height;
      add(Math.abs(r - p.ratio) < 0.03 && info.width >= p.w ? 'INFO' : 'FAIL', 'og-image-spec', `${info.width}×${info.height} (ratio ${r.toFixed(2)}), expected ${p.w}×${p.h} (${p.ratio}:1)`);
    }
    if (p.minW && info.width && info.width < p.minW && info.format !== 'svg') add('FAIL', 'gfx-resolution', `${info.width}px wide, ${purpose} needs at least ${p.minW}px`);
    if (p.maxW && info.width && info.width > p.maxW) add('WARN', 'gif-budget', `${info.width}px wide, ${purpose} rarely shows more than ${p.maxW}px`);
    if (p.square && info.width && info.height && info.width !== info.height) add('FAIL', 'favicon-set', `${info.width}×${info.height} is not square`);
    if (p.minDpi && info.width && info.format !== 'svg') {
      if (!info.dpi) add('INFO', 'gfx-resolution', 'no DPI stored: print size = pixels / 300 inches');
      add('INFO', 'gfx-resolution', `prints sharp up to ${(info.width / 300 * 25.4).toFixed(0)}×${(info.height / 300 * 25.4).toFixed(0)} mm at 300 dpi`);
    }
  }
  report.push({ file: f, kb, ...info, delays: info.delays && info.delays.length > 12 ? `${info.delays.length} values` : info.delays, issues });
}

if (asJson) console.log(JSON.stringify(report, null, 2));
else
  for (const r of report) {
    const size = r.width ? `${r.width}×${r.height}` : r.textures ? `${r.meshes} mesh(es), ${r.textures.length} texture(s)${r.textureVramMB ? ` ≈${r.textureVramMB} MB VRAM` : ''},` : '?';
    const extra = [r.animated ? `${r.frames} frames${r.fps ? `, ${r.fps} fps` : ''}${r.durationMs ? `, ${(r.durationMs / 1000).toFixed(1)} s` : ''}` : '', r.alpha ? 'alpha' : '', r.dpi ? `${r.dpi} dpi` : ''].filter(Boolean).join(', ');
    console.log(`${basename(r.file)}  ${r.format} ${size} ${r.kb} KB${extra ? ` (${extra})` : ''}`);
    for (const i of r.issues) console.log(`  ${i.level.padEnd(4)} ${i.rule.padEnd(18)} ${i.msg}`);
  }
process.exit(report.some((r) => r.issues.some((i) => i.level === 'FAIL')) ? 1 : 0);
