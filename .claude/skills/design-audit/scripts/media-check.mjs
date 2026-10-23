#!/usr/bin/env node
// Image, icon, SVG and GIF check by file headers. Node 18+, no dependencies.
// Usage: node media-check.mjs <file|folder>... [--purpose og|social|favicon|icon|print|gif-grid|gif-chat] [--json]
// Rules: graphics.md (og-image-spec, gfx-resolution, gfx-format, favicon-set, svg-hygiene,
// svg-accessible, gfx-color-profile) and media.md (gif-budget, gif-fps, gif-palette, gif-loop-intent).
// Reads PNG, JPEG, GIF, WebP, AVIF/HEIC (size only) and SVG. Flashes per frame are not
// detected here: check flash-threshold by eye.
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const purpose = opt('--purpose');
const inputs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--purpose');
if (!inputs.length) {
  console.error('Usage: node media-check.mjs <file|folder>... [--purpose og|social|favicon|icon|print|gif-grid|gif-chat] [--json]');
  process.exit(2);
}
const EXT = /\.(png|jpe?g|gif|webp|avif|heic|svg)$/i;
const files = inputs.flatMap(function walk(p) {
  const s = statSync(p);
  if (s.isDirectory()) return readdirSync(p).flatMap((f) => walk(join(p, f)));
  return EXT.test(p) ? [p] : [];
});

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
    if (marker === 0xee) info.adobe = true; // often CMYK
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
    info.durationMs = info.delays.reduce((a, d) => a + (d || 100), 0);
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
function svg(text) {
  const info = { format: 'svg', vector: true };
  const root = text.match(/<svg\b[^>]*>/i)?.[0] || '';
  const attr = (n) => root.match(new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
  info.viewBox = attr('viewBox');
  info.width = parseFloat(attr('width')) || (info.viewBox ? +info.viewBox.split(/[\s,]+/)[2] : undefined);
  info.height = parseFloat(attr('height')) || (info.viewBox ? +info.viewBox.split(/[\s,]+/)[3] : undefined);
  info.fixedSize = !!(attr('width') || attr('height'));
  info.embeddedRaster = (text.match(/<image\b[^>]*href\s*=\s*["']data:image/gi) || []).length;
  info.externalRefs = (text.match(/(?:xlink:)?href\s*=\s*["']https?:/gi) || []).length + (text.match(/@import|url\(\s*['"]?https?:/gi) || []).length;
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
  og: { w: 1200, h: 630, ratio: 1.91, maxKB: 5120, formats: ['png', 'jpeg', 'webp'] },
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
  const kb = Math.round(statSync(f).size / 1024);
  let info;
  try {
    const head = b.toString('latin1', 0, 12);
    if (b.readUInt32BE(0) === 0x89504e47) info = png(b);
    else if (b[0] === 0xff && b[1] === 0xd8) info = jpeg(b);
    else if (head.startsWith('GIF8')) info = gif(b);
    else if (head.startsWith('RIFF') && head.slice(8) === 'WEBP') info = webp(b);
    else if (head.slice(4, 8) === 'ftyp') info = isobmff(b);
    else if (/<svg\b/i.test(b.toString('utf8', 0, Math.min(b.length, 4096)))) info = svg(b.toString('utf8'));
    else info = { format: 'unknown' };
  } catch (e) {
    info = { format: 'unreadable', error: e.message };
  }
  const issues = [];
  const add = (level, rule, msg) => issues.push({ level, rule, msg });
  const ext = extname(f).slice(1).toLowerCase().replace('jpg', 'jpeg');
  if (info.format !== 'unknown' && ext && ext !== info.format && !(ext === 'heic' && info.format === 'avif')) add('WARN', 'gfx-format', `extension .${ext} but content is ${info.format}`);
  // svg
  if (info.format === 'svg') {
    if (!info.viewBox) add('FAIL', 'svg-hygiene', 'no viewBox: the icon will not scale cleanly');
    if (info.embeddedRaster) add('WARN', 'svg-hygiene', `${info.embeddedRaster} embedded raster image(s): heavy and blurry when scaled`);
    if (info.externalRefs) add('FAIL', 'svg-hygiene', `${info.externalRefs} external reference(s): breaks offline and leaks requests`);
    if (info.scripts) add('FAIL', 'svg-hygiene', 'script or on* handler inside the SVG');
    if (info.textNodes && info.fonts.length) add('WARN', 'svg-hygiene', `live text in fonts ${info.fonts.join(', ')}: renders in a fallback font where they are missing; outline the text or ship the font`);
    if (info.editorJunk) add('INFO', 'svg-hygiene', 'editor metadata left in the file (Inkscape/Sketch/Figma): optimise with SVGO');
    if (!info.title && !info.ariaHidden) add('INFO', 'svg-accessible', 'no <title> and no aria-hidden: give meaning when inlined, or mark decorative');
    if (purpose === 'icon' && info.hardcodedFills && !info.currentColor) add('INFO', 'svg-hygiene', 'colours are hard-coded: use currentColor if the icon must follow text colour');
  }
  // gif / animation
  if (info.format === 'gif') {
    if (info.fps && (info.fps < 10 || info.fps > 30)) add('WARN', 'gif-fps', `${info.fps} fps (10–30 recommended)`);
    if (info.delays?.some((d) => d === 0)) add('WARN', 'gif-fps', 'frames with 0 delay: browsers stretch them to ~100 ms, timing will differ');
    if (info.localPalettes > 1) add('WARN', 'gif-palette', `${info.localPalettes} frames carry their own palette: flicker and weight, use one global palette`);
    if (info.globalPalette && info.globalPalette > 128 && info.frames > 1) add('INFO', 'gif-palette', `global palette of ${info.globalPalette} colours: 48–128 is usually enough`);
    if (info.animated && info.loop === null) add('INFO', 'gif-loop-intent', 'plays once (no loop extension): make sure the last frame is the intended end state');
    if (kb > 2048) add('WARN', 'gif-budget', `${kb} KB: a looping video (MP4/WebM) would be 5–10× lighter`);
  }
  if (info.cmyk || info.adobe) add('WARN', 'gfx-color-profile', 'JPEG looks CMYK/Adobe: colours shift on screens, export in sRGB');
  if (info.iccProfile && !/srgb/i.test(info.iccProfile) && info.iccProfile !== 'embedded') add('INFO', 'gfx-color-profile', `colour profile "${info.iccProfile}": use sRGB for screens`);
  // purpose
  const p = PURPOSE[purpose];
  if (p) {
    if (p.maxKB && kb > p.maxKB) add('FAIL', purpose.startsWith('gif') ? 'gif-budget' : 'gfx-resolution', `${kb} KB, budget for ${purpose} is ${p.maxKB} KB${p.note ? ` (${p.note})` : ''}`);
    if (p.formats && !p.formats.includes(info.format)) add('FAIL', 'og-image-spec', `${info.format} is not supported by link previews everywhere (use ${p.formats.join('/')})`);
    if (p.w && info.width && (info.width !== p.w || info.height !== p.h)) {
      const r = info.width / info.height;
      add(Math.abs(r - p.ratio) < 0.03 && info.width >= p.w ? 'INFO' : 'FAIL', 'og-image-spec', `${info.width}×${info.height} (ratio ${r.toFixed(2)}), expected ${p.w}×${p.h} (${p.ratio}:1)`);
    }
    if (p.minW && info.width && info.width < p.minW) add('FAIL', 'gfx-resolution', `${info.width}px wide, ${purpose} needs at least ${p.minW}px`);
    if (p.maxW && info.width && info.width > p.maxW) add('WARN', 'gif-budget', `${info.width}px wide, ${purpose} rarely shows more than ${p.maxW}px`);
    if (p.square && info.width && info.height && info.width !== info.height) add('FAIL', 'favicon-set', `${info.width}×${info.height} is not square`);
    if (p.minDpi && info.format !== 'svg') {
      if (!info.dpi) add('INFO', 'doc-print-ready', 'no DPI stored: print size = pixels / 300 inches');
      add('INFO', 'doc-print-ready', `prints sharp up to ${(info.width / 300 * 25.4).toFixed(0)}×${(info.height / 300 * 25.4).toFixed(0)} mm at 300 dpi`);
    }
  }
  report.push({ file: f, kb, ...info, delays: info.delays && info.delays.length > 12 ? `${info.delays.length} values` : info.delays, issues });
}

if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
else
  for (const r of report) {
    const size = r.width ? `${r.width}×${r.height}` : '?';
    const extra = [r.animated ? `${r.frames} frames${r.fps ? `, ${r.fps} fps` : ''}${r.durationMs ? `, ${(r.durationMs / 1000).toFixed(1)} s` : ''}` : '', r.alpha ? 'alpha' : '', r.dpi ? `${r.dpi} dpi` : ''].filter(Boolean).join(', ');
    console.log(`${basename(r.file)}  ${r.format} ${size} ${r.kb} KB${extra ? ` (${extra})` : ''}`);
    for (const i of r.issues) console.log(`  ${i.level.padEnd(4)} ${i.rule.padEnd(18)} ${i.msg}`);
  }
process.exit(report.some((r) => r.issues.some((i) => i.level === 'FAIL')) ? 1 : 0);
