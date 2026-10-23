#!/usr/bin/env node
// Structural check of .pptx and .docx without rendering. Node 18+, no dependencies.
// Usage: node office-check.mjs <file.pptx|file.docx>... [--json]
// Rules: slides.md (slide-off-canvas, slide-overlap, slide-margins, slide-type-scale,
// slide-font-substitution, slide-leftovers, fake-bullets, slide-alt-text, slide-reading-order,
// slide-text-overflow as an estimate) and documents.md (doc-heading-styles, fake-bullets,
// doc-manual-layout, doc-table-widths, doc-alt-text, doc-meta, doc-type-scale).
// What it cannot see: the rendered look. Overflow is estimated from text length and box size;
// confirm on rendered slides or pages (export to PDF) before reporting it as fact.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { basename, extname } from 'node:path';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('Usage: node office-check.mjs <file.pptx|file.docx>... [--json]');
  process.exit(2);
}

// ---------- zip ----------
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('not a zip container');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const texts = (xml) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1] ?? m[2]);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const LEFTOVER = /lorem ipsum|click to add|нажмите, чтобы добавить|заголовок слайда|текст слайда|\bxxx+\b|\btodo\b|\[insert|\[вставить|placeholder/i;
const FAKE_BULLET = /^\s*(?:[•·▪◦‣●○■□–—*]|-\s|\d{1,2}[.)]\s)/;

// ---------- pptx ----------
function pptx(z, add) {
  const pres = z.get('ppt/presentation.xml')?.() || '';
  const sz = pres.match(/<p:sldSz\b[^>]*>/)?.[0] || '';
  const W = +attr(sz, 'cx') || 12192000, H = +attr(sz, 'cy') || 6858000;
  const embedded = /<p:embeddedFont\b/.test(pres);
  const theme = z.get('ppt/theme/theme1.xml')?.() || '';
  const major = theme.match(/<a:majorFont>[\s\S]*?<a:latin typeface="([^"]*)"/)?.[1];
  const minor = theme.match(/<a:minorFont>[\s\S]*?<a:latin typeface="([^"]*)"/)?.[1];
  const slides = [...z.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => +a.match(/\d+/g).pop() - +b.match(/\d+/g).pop());
  const fonts = new Set([major, minor].filter(Boolean));
  const allSizes = [];
  const info = { slides: slides.length, size: `${(W / 914400).toFixed(2)}×${(H / 914400).toFixed(2)} in`, fontsEmbedded: embedded };
  slides.forEach((path, si) => {
    const n = si + 1;
    let xml = z.get(path)();
    const groups = (xml.match(/<p:grpSp>/g) || []).length;
    for (let guard = 0; guard < 20 && /<p:grpSp>/.test(xml); guard++) xml = xml.replace(/<p:grpSp>(?:(?!<p:grpSp>)[\s\S])*?<\/p:grpSp>/g, ''); // group children use group coordinates
    const shapes = [...xml.matchAll(/<p:(sp|pic|graphicFrame|cxnSp)\b[\s\S]*?<\/p:\1>/g)].map((m) => {
      const s = m[0];
      const nv = s.match(/<p:cNvPr\b[^>]*>/)?.[0] || '';
      const off = s.match(/<a:off\b[^>]*>/)?.[0], ext = s.match(/<a:ext\b[^>]*cx="[^"]*"[^>]*>/)?.[0];
      const t = texts(s).map(decode);
      const sizes = [...s.matchAll(/\ssz="(\d+)"/g)].map((x) => +x[1] / 100);
      for (const f of s.matchAll(/<a:latin typeface="([^"]*)"/g)) if (!f[1].startsWith('+')) fonts.add(f[1]);
      return {
        kind: m[1],
        name: attr(nv, 'name') || '',
        descr: attr(nv, 'descr'),
        decorative: /decorative val="1"/.test(s),
        ph: s.match(/<p:ph\b[^>]*>/)?.[0],
        box: off && ext ? { x: +attr(off, 'x'), y: +attr(off, 'y'), w: +attr(ext, 'cx'), h: +attr(ext, 'cy') } : null,
        text: t.join(' ').trim(),
        paras: [...s.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((p) => texts(p[1]).map(decode).join('')),
        sizes,
        autofit: /<a:normAutofit|<a:spAutoFit/.test(s),
        chart: /c:chart\b/.test(s),
      };
    });
    if (groups) add('INFO', 'slide-overlap', `slide ${n}: ${groups} group(s) not measured (children use group coordinates)`);
    const textShapes = shapes.filter((s) => s.text && s.box);
    for (const s of shapes) {
      if (!s.box) continue;
      const { x, y, w, h } = s.box;
      if (x < -W * 0.01 || y < -H * 0.01 || x + w > W * 1.01 || y + h > H * 1.01) add(s.text ? 'FAIL' : 'WARN', s.text ? 'slide-text-overflow' : 'slide-off-canvas', `slide ${n}: "${s.name}" lies partly outside the slide`);
      if (s.text && (x < W * 0.04 || y < H * 0.04 || x + w > W * 0.96 || y + h > H * 0.96)) add('WARN', 'slide-margins', `slide ${n}: text "${s.text.slice(0, 30)}" closer than ~4% to the edge`);
    }
    for (let i = 0; i < textShapes.length; i++)
      for (let j = i + 1; j < textShapes.length; j++) {
        const a = textShapes[i].box, b = textShapes[j].box;
        const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        if (ix * iy > 0.04 * Math.min(a.w * a.h, b.w * b.h)) add('WARN', 'slide-overlap', `slide ${n}: text boxes "${textShapes[i].text.slice(0, 24)}" and "${textShapes[j].text.slice(0, 24)}" overlap`);
      }
    // overflow estimate: average glyph ≈ 0.5 em wide, line ≈ 1.2 em
    for (const s of textShapes) {
      if (s.autofit) continue;
      const pt = s.sizes.length ? Math.min(...s.sizes) : 18;
      const boxWpt = s.box.w / 12700, boxHpt = s.box.h / 12700;
      const lines = s.paras.reduce((acc, p) => acc + Math.max(1, Math.ceil((p.length * pt * 0.5) / Math.max(1, boxWpt - 14))), 0);
      if (lines * pt * 1.2 > boxHpt * 1.15 && lines > 1) add('WARN', 'slide-text-overflow', `slide ${n}: "${s.text.slice(0, 30)}" may not fit its box (estimate ${lines} lines of ${pt} pt in ${boxHpt.toFixed(0)} pt): confirm on a render`);
    }
    const sizes = shapes.flatMap((s) => s.sizes);
    allSizes.push(...sizes);
    if (sizes.length && Math.min(...sizes) < 18) add(Math.min(...sizes) < 10 ? 'FAIL' : Math.min(...sizes) < 12 ? 'WARN' : 'INFO', 'slide-type-scale', `slide ${n}: text at ${Math.min(...sizes)} pt (≥ 18 pt to project, ≥ 12 pt to read as PDF)`);
    if (new Set(sizes).size > 4) add('INFO', 'slide-type-scale', `slide ${n}: ${new Set(sizes).size} different font sizes`);
    for (const s of shapes) {
      if (s.text && LEFTOVER.test(s.text)) add('FAIL', 'slide-leftovers', `slide ${n}: template leftover "${s.text.slice(0, 40)}"`);
      if (s.ph && !s.text && s.kind === 'sp' && !/type="(?:sldNum|dt|ftr|pic)"/.test(s.ph)) add('INFO', 'slide-leftovers', `slide ${n}: empty placeholder "${s.name}"`);
      for (const p of s.paras) if (FAKE_BULLET.test(p)) add('WARN', 'fake-bullets', `slide ${n}: typed bullet in "${p.slice(0, 30)}"`);
      if (s.kind === 'pic' && !s.decorative && !(s.descr || '').trim()) add('WARN', 'slide-alt-text', `slide ${n}: picture "${s.name}" has no alt text`);
    }
    const title = shapes.findIndex((s) => s.ph && /type="(?:title|ctrTitle)"/.test(s.ph));
    if (title > 0 && shapes.slice(0, title).some((s) => s.text)) add('INFO', 'slide-reading-order', `slide ${n}: the title is not first in reading order`);
    info.charts = (info.charts || 0) + shapes.filter((s) => s.chart).length;
    info.pictures = (info.pictures || 0) + shapes.filter((s) => s.kind === 'pic').length;
  });
  info.fonts = [...fonts];
  info.fontSizes = [...new Set(allSizes)].sort((a, b) => a - b);
  if (!embedded) add('INFO', 'slide-font-substitution', `fonts not embedded: ${info.fonts.join(', ') || 'theme fonts'} must exist on the presenting machine and cover every language of the deck`);
  return info;
}

// ---------- docx ----------
function docx(z, add) {
  const doc = z.get('word/document.xml')?.() || '';
  const styles = z.get('word/styles.xml')?.() || '';
  const core = z.get('docProps/core.xml')?.() || '';
  const headingStyles = new Set();
  for (const m of styles.matchAll(/<w:style\b[^>]*w:styleId="([^"]*)"[^>]*>([\s\S]*?)<\/w:style>/g))
    if (/<w:outlineLvl\b/.test(m[2]) || /<w:name w:val="(?:heading \d|Title|Заголовок)/i.test(m[2])) headingStyles.add(m[1]);
  const defaults = styles.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/)?.[0] || '';
  const bodySz = +(defaults.match(/<w:sz w:val="(\d+)"/)?.[1] || 22) / 2;
  const lang = defaults.match(/<w:lang\b[^>]*w:val="([^"]*)"/)?.[1];
  // <w:p/> is an empty paragraph; a plain <w:p\b[^>]*> would swallow it and glue paragraphs together
  const paras = [...doc.matchAll(/<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((m) => {
    const p = m[1] || '';
    const style = p.match(/<w:pStyle w:val="([^"]*)"/)?.[1];
    const runs = [...p.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)].map((r) => r[1]);
    const text = decode(texts(p).join(''));
    return {
      text,
      style,
      heading: (style && headingStyles.has(style)) || /<w:outlineLvl\b/.test(p),
      list: /<w:numPr>/.test(p),
      allBold: runs.length > 0 && runs.filter((r) => /<w:t\b/.test(r)).every((r) => /<w:b\/>|<w:b w:val="(?:1|true)"\/>/.test(r)),
      maxSz: Math.max(0, ...[...p.matchAll(/<w:sz w:val="(\d+)"/g)].map((x) => +x[1] / 2)),
      tabs: (p.match(/<w:tab\/>/g) || []).length,
    };
  });
  const headings = paras.filter((p) => p.heading).length;
  const fakeHeadings = paras.filter((p) => !p.heading && !p.list && p.text.length > 0 && p.text.length < 90 && !/[.:;,]$/.test(p.text.trim()) && (p.allBold || p.maxSz >= bodySz + 3));
  if (fakeHeadings.length) add(headings ? 'WARN' : 'FAIL', 'doc-heading-styles', `${fakeHeadings.length} paragraph(s) look like headings but use no heading style, e.g. "${fakeHeadings[0].text.slice(0, 40)}"${headings ? '' : '; the document has no real headings at all'}`);
  const fakeLists = paras.filter((p) => !p.list && FAKE_BULLET.test(p.text));
  if (fakeLists.length) add('WARN', 'fake-bullets', `${fakeLists.length} paragraph(s) start with a typed bullet or number, e.g. "${fakeLists[0].text.slice(0, 30)}"`);
  let empties = 0, maxEmpties = 0;
  for (const p of paras) (empties = p.text.trim() ? 0 : empties + 1), (maxEmpties = Math.max(maxEmpties, empties));
  if (maxEmpties >= 3) add('WARN', 'doc-manual-layout', `${maxEmpties} empty paragraphs in a row: use spacing or a page break`);
  const spaced = paras.filter((p) => / {4,}/.test(p.text) || p.tabs >= 3);
  if (spaced.length) add('INFO', 'doc-manual-layout', `${spaced.length} paragraph(s) aligned with runs of spaces or tabs`);
  const tables = (doc.match(/<w:tbl>/g) || []).length;
  if (/<w:(?:tblW|tcW)\b[^>]*w:type="pct"/.test(doc)) add('INFO', 'doc-table-widths', 'table widths in percent: they break in Google Docs and some converters, use fixed widths');
  if (tables && !/<w:tblHeader\/>/.test(doc)) add('INFO', 'doc-table-widths', `${tables} table(s) without a repeating header row`);
  const pics = [...doc.matchAll(/<wp:docPr\b[^>]*>/g)].map((m) => m[0]);
  const noAlt = pics.filter((t) => !(attr(t, 'descr') || '').trim() && !/decorative/.test(t));
  if (noAlt.length) add('WARN', 'doc-alt-text', `${noAlt.length} of ${pics.length} picture(s) without alt text`);
  const title = decode(core.match(/<dc:title>([^<]*)<\/dc:title>/)?.[1] || '').trim();
  if (!title) add('WARN', 'doc-meta', 'no document title (File → Properties): PDF exports show the file name instead');
  if (!lang) add('INFO', 'doc-meta', 'no default language in styles: spellcheck and screen readers guess');
  if (bodySz < 10) add('WARN', 'doc-type-scale', `default body text ${bodySz} pt (10–12 pt for print)`);
  const fonts = new Set([...doc.matchAll(/<w:rFonts\b[^>]*w:ascii="([^"]*)"/g), ...styles.matchAll(/<w:rFonts\b[^>]*w:ascii="([^"]*)"/g)].map((m) => m[1]));
  if (fonts.size > 3) add('INFO', 'doc-type-scale', `${fonts.size} font families: ${[...fonts].join(', ')}`);
  for (const p of paras) if (LEFTOVER.test(p.text)) add('FAIL', 'slide-leftovers', `template leftover "${p.text.slice(0, 40)}"`);
  return { paragraphs: paras.length, headings, tables, pictures: pics.length, bodyPt: bodySz, language: lang || null, title: title || null, fonts: [...fonts] };
}

const out = [];
for (const f of files) {
  const issues = [];
  const add = (level, rule, msg) => issues.push({ level, rule, msg });
  let info = {};
  try {
    const z = unzip(readFileSync(f));
    const ext = extname(f).toLowerCase();
    if (ext === '.pptx' || z.has('ppt/presentation.xml')) info = { type: 'pptx', ...pptx(z, add) };
    else if (ext === '.docx' || z.has('word/document.xml')) info = { type: 'docx', ...docx(z, add) };
    else add('FAIL', 'format', 'neither a .pptx nor a .docx');
  } catch (e) {
    add('FAIL', 'format', e.message);
  }
  out.push({ file: f, ...info, issues });
}
if (args.includes('--json')) console.log(JSON.stringify(out, null, 2));
else
  for (const r of out) {
    const { file, issues, ...info } = r;
    console.log(`${basename(file)}  ${JSON.stringify(info)}`);
    for (const i of issues) console.log(`  ${i.level.padEnd(4)} ${i.rule.padEnd(24)} ${i.msg}`);
  }
process.exit(out.some((r) => r.issues.some((i) => i.level === 'FAIL')) ? 1 : 0);
