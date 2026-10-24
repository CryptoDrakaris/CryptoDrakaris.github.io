#!/usr/bin/env node
// Structural check of .pptx and .docx without rendering. Node 18+, no dependencies.
// Usage: node office-check.mjs <file.pptx|file.docx>... [--json]
// Rules: slides.md (slide-off-canvas, slide-overlap, slide-margins, slide-type-scale,
// slide-density, slide-font-substitution, slide-leftovers, fake-bullets, slide-alt-text,
// slide-reading-order, slide-text-overflow as an estimate) and documents.md (doc-heading-styles,
// fake-bullets, doc-manual-layout, doc-table-widths, doc-alt-text, doc-meta, doc-type-scale,
// doc-leftovers, doc-weight). `format` – the file cannot be read.
// Placeholders without their own position or size take them from the slide layout and master
// (position, font size); other inherited formatting is not resolved.
// What it cannot see: the rendered look. Overflow is estimated from text length and box size;
// confirm on rendered slides or pages (export to PDF) before reporting it as fact.
// Levels: FAIL, WARN, INFO and N/A – the rule had nothing to check in this file (no pictures,
// no tables): N/A is not a pass, report it apart from what was checked and found fine.
// Exit code: 0 no FAIL, 1 at least one FAIL, 2 bad input.
import { readFileSync, statSync } from 'node:fs';
import { unzip as unzipRaw } from './zip.mjs';
import { basename, extname, posix } from 'node:path';

const USAGE = 'Usage: node office-check.mjs <file.pptx|file.docx>... [--json]';
const args = process.argv.slice(2);
const bad = args.find((a) => a.startsWith('-') && a !== '--json');
if (bad === '--help' || bad === '-h') {
  console.log(USAGE);
  process.exit(0);
}
if (bad) {
  console.error(`Error: unknown option ${bad}\n${USAGE}`);
  process.exit(2);
}
const files = args.filter((a) => !a.startsWith('-'));
if (!files.length) {
  console.error(USAGE);
  process.exit(2);
}
for (const f of files) {
  let s = null;
  try {
    s = statSync(f);
  } catch {}
  if (!s || !s.isFile()) {
    console.error(`Error: ${f} ${s ? 'is not a file' : 'does not exist'}`);
    process.exit(2);
  }
}

// ---------- zip ----------
function unzip(buf) {
  // an encrypted OOXML file and the old binary .ppt/.doc are OLE compound files, not zips
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0xd0cf11e0 && buf.readUInt32BE(4) === 0xa1b11ae1) throw new Error('password-protected or legacy binary Office file (OLE container): save a copy without a password as .pptx/.docx');
  const z = unzipRaw(buf);
  return new Map([...z].map(([name, read]) => [name, () => read().toString('utf8')]));
}

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const texts = (xml) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1] ?? m[2]);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(x?)([0-9a-f]+);/gi, (_, x, n) => String.fromCodePoint(parseInt(n, x ? 16 : 10))).replace(/&amp;/g, '&');
const LEFTOVER = /lorem ipsum|click to add|нажмите, чтобы добавить|заголовок слайда|текст слайда|\bxxx+\b|\[insert|\[вставить|\[placeholder|placeholder text|текст-заполнитель/i;
const LEFTOVER_CASE = /\bTODO\b|\bTBD\b/;
const leftover = (t) => LEFTOVER.test(t) || LEFTOVER_CASE.test(t);
// a real bullet glyph is a typed list on its own; a dash, an asterisk or "1." only when two
// paragraphs in a row start the same way (a lone "— Author" is an attribution, "*Note" a footnote)
const STRONG_BULLET = /^\s*[•·▪◦‣●○■□]/;
const WEAK_BULLET = /^\s*([-–—*]\s|\d{1,2}[.)]\s)/;
const markerOf = (t) => (STRONG_BULLET.test(t) ? 'strong' : t.match(WEAK_BULLET)?.[1].replace(/\d+/, '#').trim() ?? null);
function typedBullets(paras) {
  const out = [];
  paras.forEach((p, i) => {
    const m = markerOf(p);
    if (!m) return;
    if (m === 'strong' || markerOf(paras[i - 1] ?? '') === m || markerOf(paras[i + 1] ?? '') === m) out.push(p);
  });
  return out;
}
const DECORATIVE = /<(?:\w+:)?decorative\b[^>]*\bval="(?:1|true)"/;

// ---------- pptx ----------
// direct children of a shape tree, with group transforms applied to the children's boxes
function shapesOf(tree, tf = (b) => b) {
  const out = [];
  const re = /<(\/?)p:(sp|pic|graphicFrame|cxnSp|grpSp)(?![\w-])[^>]*?(\/?)>/g;
  const stack = [];
  let m;
  while ((m = re.exec(tree))) {
    if (m[3]) continue; // <p:sp/> has no content
    if (!m[1]) {
      stack.push({ kind: m[2], start: m.index });
      continue;
    }
    const open = stack.pop();
    if (!open || open.kind !== m[2]) continue;
    if (stack.length) continue; // nested: handled by the group
    const xml = tree.slice(open.start, m.index + m[0].length);
    if (open.kind === 'grpSp') {
      const x = xml.match(/<p:grpSpPr\b[\s\S]*?<\/p:grpSpPr>/)?.[0] || '';
      const n = (re2) => x.match(re2);
      const off = n(/<a:off\b[^>]*>/)?.[0], ext = n(/<a:ext\b[^>]*>/)?.[0], chOff = n(/<a:chOff\b[^>]*>/)?.[0], chExt = n(/<a:chExt\b[^>]*>/)?.[0];
      let inner = tf;
      if (off && ext && chOff && chExt) {
        const sx = +attr(ext, 'cx') / (+attr(chExt, 'cx') || 1), sy = +attr(ext, 'cy') / (+attr(chExt, 'cy') || 1);
        inner = (b) => tf({ x: +attr(off, 'x') + (b.x - +attr(chOff, 'x')) * sx, y: +attr(off, 'y') + (b.y - +attr(chOff, 'y')) * sy, w: b.w * sx, h: b.h * sy });
      }
      const body = xml.slice(xml.indexOf('>') + 1, xml.lastIndexOf('</p:grpSp>'));
      out.push(...shapesOf(body.replace(/<p:nvGrpSpPr\b[\s\S]*?<\/p:nvGrpSpPr>|<p:grpSpPr\b[\s\S]*?<\/p:grpSpPr>/g, ''), inner).map((s) => ({ ...s, inGroup: true })));
    } else out.push({ kind: open.kind, xml, tf });
  }
  return out;
}
const boxOf = (s) => {
  const xfrm = s.match(/<(?:a|p):xfrm\b[\s\S]*?<\/(?:a|p):xfrm>/)?.[0] || '';
  const off = xfrm.match(/<a:off\b[^>]*>/)?.[0], ext = xfrm.match(/<a:ext\b[^>]*cx="[^"]*"[^>]*>/)?.[0];
  return off && ext ? { x: +attr(off, 'x'), y: +attr(off, 'y'), w: +attr(ext, 'cx'), h: +attr(ext, 'cy') } : null;
};
const phOf = (s) => s.match(/<p:ph\b[^>]*>/)?.[0];
const phType = (ph) => attr(ph, 'type') || 'body';
const runSizes = (xml) => [...xml.matchAll(/<a:r>([\s\S]*?)<\/a:r>|<a:fld\b[^>]*>([\s\S]*?)<\/a:fld>/g)].filter((r) => texts(r[0]).join('').trim()).map((r) => r[0].match(/<a:rPr\b[^>]*\ssz="(\d+)"/)?.[1]).filter(Boolean).map((v) => +v / 100);
const lvl1Size = (xml) => +(xml?.match(/<a:lvl1pPr\b[\s\S]*?<a:defRPr\b[^>]*\ssz="(\d+)"/)?.[1] || 0) / 100 || null;

function pptx(z, add) {
  const get = (p) => (z.has(p) ? z.get(p)() : '');
  const rels = (p) => {
    const r = get(posix.join(posix.dirname(p), '_rels', posix.basename(p) + '.rels'));
    return new Map([...r.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), { type: attr(m[0], 'Type') || '', target: posix.normalize(posix.join(posix.dirname(p), attr(m[0], 'Target') || '')) }]));
  };
  const relOfType = (p, type) => [...rels(p).values()].find((r) => r.type.endsWith('/' + type))?.target;
  const pres = get('ppt/presentation.xml');
  const sz = pres.match(/<p:sldSz\b[^>]*>/)?.[0] || '';
  const W = +attr(sz, 'cx') || 12192000, H = +attr(sz, 'cy') || 6858000;
  const embedded = /<p:embeddedFont\b/.test(pres);
  const theme = get('ppt/theme/theme1.xml');
  const major = theme.match(/<a:majorFont>[\s\S]*?<a:latin typeface="([^"]*)"/)?.[1];
  const minor = theme.match(/<a:minorFont>[\s\S]*?<a:latin typeface="([^"]*)"/)?.[1];
  // slide order is the order of sldIdLst, not of file names
  const presRels = rels('ppt/presentation.xml');
  const listed = [...pres.matchAll(/<p:sldId\b[^>]*>/g)].map((m) => presRels.get(attr(m[0], 'r:id'))?.target).filter((p) => p && z.has(p));
  const slides = listed.length ? listed : [...z.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => +a.match(/\d+/g).pop() - +b.match(/\d+/g).pop());
  const fonts = new Set([major, minor].filter(Boolean));
  const allSizes = [];
  const hidden = [];
  const info = { slides: slides.length, size: `${(W / 914400).toFixed(2)}×${(H / 914400).toFixed(2)} in`, fontsEmbedded: embedded };
  // placeholders on layouts and masters, for position and size inheritance
  const phCache = new Map();
  const placeholders = (path) => {
    if (!path || !z.has(path)) return [];
    if (!phCache.has(path)) phCache.set(path, shapesOf(get(path)).map((s) => ({ ph: phOf(s.xml), box: boxOf(s.xml), size: lvl1Size(s.xml.match(/<a:lstStyle>[\s\S]*?<\/a:lstStyle>/)?.[0]) })).filter((p) => p.ph));
    return phCache.get(path);
  };
  const matchPh = (list, ph) => {
    const t = phType(ph), idx = attr(ph, 'idx');
    return list.find((p) => idx && attr(p.ph, 'idx') === idx) ?? list.find((p) => phType(p.ph) === t) ?? (t === 'body' ? null : list.find((p) => phType(p.ph) === (t === 'ctrTitle' ? 'title' : t)));
  };
  slides.forEach((path, si) => {
    const n = si + 1;
    const xml = get(path);
    if (/<p:sld\b[^>]*\sshow="0"/.test(xml)) return hidden.push(n);
    const layout = relOfType(path, 'slideLayout') ?? (z.has('ppt/slideLayouts/slideLayout1.xml') ? 'ppt/slideLayouts/slideLayout1.xml' : null);
    const master = (layout && relOfType(layout, 'slideMaster')) ?? (z.has('ppt/slideMasters/slideMaster1.xml') ? 'ppt/slideMasters/slideMaster1.xml' : null);
    const masterXml = master ? get(master) : '';
    const txStyle = (t) => lvl1Size(masterXml.match(t === 'title' || t === 'ctrTitle' ? /<p:titleStyle>[\s\S]*?<\/p:titleStyle>/ : t === 'body' || t === 'subTitle' || t === 'obj' ? /<p:bodyStyle>[\s\S]*?<\/p:bodyStyle>/ : /<p:otherStyle>[\s\S]*?<\/p:otherStyle>/)?.[0]);
    const tree = xml.match(/<p:spTree>([\s\S]*)<\/p:spTree>/)?.[1] || '';
    const shapes = shapesOf(tree).map(({ kind, xml: s, tf, inGroup }) => {
      const nv = s.match(/<p:cNvPr\b[^>]*?(?:\/>|>[\s\S]*?<\/p:cNvPr>)/)?.[0] || '';
      const ph = phOf(s);
      const fromLayout = ph ? matchPh(placeholders(layout), ph) : null;
      const fromMaster = ph ? matchPh(placeholders(master), ph) : null;
      const own = boxOf(s);
      const box = own ?? fromLayout?.box ?? fromMaster?.box ?? null;
      let sizes = runSizes(s);
      const t = texts(s).map(decode);
      const text = t.join(' ').trim();
      // a run without its own size takes the placeholder's size from the layout or master
      const unsized = [...s.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)].some((r) => texts(r[0]).join('').trim() && !/<a:rPr\b[^>]*\ssz="/.test(r[0]));
      if (unsized && ph) {
        const inherited = lvl1Size(s.match(/<a:lstStyle>[\s\S]*?<\/a:lstStyle>/)?.[0]) ?? fromLayout?.size ?? fromMaster?.size ?? txStyle(phType(ph));
        if (inherited) sizes = [...sizes, inherited];
      }
      for (const f of s.matchAll(/<a:latin typeface="([^"]*)"/g)) if (!f[1].startsWith('+')) fonts.add(f[1]);
      return {
        kind,
        name: attr(nv, 'name') || '',
        descr: attr(nv, 'descr'),
        decorative: DECORATIVE.test(nv),
        ph,
        inGroup,
        box: box && tf(box),
        inherited: !own && !!box,
        text,
        paras: [...s.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((p) => decode(texts(p[1]).join(''))),
        sizes,
        autofit: /<a:normAutofit|<a:spAutoFit/.test(s),
        chart: /c:chart\b/.test(s),
      };
    });
    const textShapes = shapes.filter((s) => s.text && s.box);
    // footers, slide numbers and dates sit on the edge by design
    const furniture = (s) => s.ph && /type="(?:ftr|sldNum|dt)"/.test(s.ph);
    for (const s of shapes) {
      if (!s.box) continue;
      const { x, y, w, h } = s.box;
      const where = s.inherited ? ' (position from the slide layout)' : s.inGroup ? ' (inside a group)' : '';
      if (x < -W * 0.01 || y < -H * 0.01 || x + w > W * 1.01 || y + h > H * 1.01) add(s.text ? 'FAIL' : 'WARN', 'slide-off-canvas', `slide ${n}: ${s.text ? `text "${s.text.slice(0, 30)}"` : `"${s.name}"`} lies partly outside the slide${where}`);
      else if (s.text && !furniture(s) && (x < W * 0.05 || y < H * 0.05 || x + w > W * 0.95 || y + h > H * 0.95)) add('WARN', 'slide-margins', `slide ${n}: text "${s.text.slice(0, 30)}" closer than ~5% to the edge${where}`);
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
    const lines = shapes.filter((s) => !(s.ph && /type="(?:title|ctrTitle|ftr|sldNum|dt)"/.test(s.ph))).flatMap((s) => s.paras).filter((p) => p.trim()).length;
    if (lines > 6) add('INFO', 'slide-density', `slide ${n}: ${lines} lines of text besides the title (~6 for a slide that is shown)`);
    for (const s of shapes) {
      if (s.text && leftover(s.text)) add('FAIL', 'slide-leftovers', `slide ${n}: template leftover "${s.text.slice(0, 40)}"`);
      if (s.ph && !s.text && s.kind === 'sp' && !/type="(?:sldNum|dt|ftr|pic)"/.test(s.ph)) add('INFO', 'slide-leftovers', `slide ${n}: empty placeholder "${s.name}"`);
      for (const p of typedBullets(s.paras)) add('WARN', 'fake-bullets', `slide ${n}: typed bullet in "${p.slice(0, 30)}"`);
      if (s.kind === 'pic' && !s.decorative && !(s.descr || '').trim()) add('WARN', 'slide-alt-text', `slide ${n}: picture "${s.name}" has no alt text`);
    }
    const title = shapes.findIndex((s) => s.ph && /type="(?:title|ctrTitle)"/.test(s.ph));
    if (title > 0 && shapes.slice(0, title).some((s) => s.text)) add('INFO', 'slide-reading-order', `slide ${n}: the title is not first in reading order`);
    info.charts = (info.charts || 0) + shapes.filter((s) => s.chart).length;
    info.pictures = (info.pictures || 0) + shapes.filter((s) => s.kind === 'pic').length;
  });
  if (hidden.length) {
    info.hiddenSlides = hidden;
    add('INFO', 'slide-leftovers', `hidden slide(s) ${hidden.join(', ')} not checked: delete them or check after unhiding`);
  }
  info.fonts = [...fonts];
  info.fontSizes = [...new Set(allSizes)].sort((a, b) => a - b);
  if (!info.pictures) add('N/A', 'slide-alt-text', 'no pictures in the deck');
  if (!embedded) add('INFO', 'slide-font-substitution', `fonts not embedded: ${info.fonts.join(', ') || 'theme fonts'} must exist on the presenting machine and cover every language of the deck`);
  return info;
}

// ---------- docx ----------
function docx(z, add) {
  const get = (p) => (z.has(p) ? z.get(p)() : '');
  let doc = get('word/document.xml');
  const styles = get('word/styles.xml');
  const core = get('docProps/core.xml');
  // styles with their basedOn chain: the nearest outline level wins (9 = body text)
  const styleMap = new Map();
  for (const m of styles.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = attr(m[0], 'w:styleId');
    if (!id) continue;
    const lvl = m[2].match(/<w:outlineLvl w:val="(\d+)"/)?.[1];
    styleMap.set(id, {
      type: attr(m[1], 'w:type'),
      isDefault: /w:default="(?:1|true)"/.test(m[1]),
      name: m[2].match(/<w:name w:val="([^"]*)"/)?.[1] || '',
      basedOn: m[2].match(/<w:basedOn w:val="([^"]*)"/)?.[1],
      outline: lvl === undefined ? undefined : +lvl,
      sz: m[2].match(/<w:rPr>[\s\S]*?<w:sz w:val="(\d+)"/)?.[1],
    });
  }
  const chain = (id) => {
    const out = [];
    for (let s = styleMap.get(id), guard = 0; s && guard < 20; s = styleMap.get(s.basedOn), guard++) out.push(s);
    return out;
  };
  const styleHeading = (id) => {
    for (const s of chain(id)) {
      if (s.outline !== undefined) return s.outline < 9;
      if (/^(heading \d|title)$/i.test(s.name) || /^заголовок/i.test(s.name)) return true;
    }
    return false;
  };
  const defaults = styles.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/)?.[0] || '';
  // body size: the default paragraph style (Normal) wins over docDefaults
  const normalId = [...styleMap].find(([, v]) => v.type === 'paragraph' && v.isDefault)?.[0];
  const bodySz = +((normalId && chain(normalId).find((s) => s.sz)?.sz) || defaults.match(/<w:sz w:val="(\d+)"/)?.[1] || 22) / 2;
  const lang = defaults.match(/<w:lang\b[^>]*w:val="([^"]*)"/)?.[1];
  // text boxes hold their own paragraphs inside a paragraph of the main flow
  const boxes = [];
  doc = doc.replace(/<w:txbxContent>([\s\S]*?)<\/w:txbxContent>/g, (_, inner) => (boxes.push(inner), ''));
  // paragraphs inside tables (bold header cells are not headings)
  const tableSpans = [];
  {
    const re = /<(\/?)w:tbl>/g;
    let depth = 0, start = 0, m;
    while ((m = re.exec(doc))) {
      if (!m[1]) depth++ === 0 && (start = m.index);
      else if (--depth === 0) tableSpans.push([start, m.index]);
    }
  }
  const inTable = (at) => tableSpans.some(([a, b]) => at > a && at < b);
  // <w:p/> is an empty paragraph; a plain <w:p\b[^>]*> would swallow it and glue paragraphs together
  const paraRe = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
  const parse = (xml, box) =>
    [...xml.matchAll(paraRe)].map((m) => {
      const p = m[1] || '';
      const style = p.match(/<w:pStyle w:val="([^"]*)"/)?.[1];
      const runs = [...p.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)].map((r) => r[1]);
      const text = decode(texts(p).join(''));
      const lvl = p.match(/<w:pPr>[\s\S]*?<w:outlineLvl w:val="(\d+)"/)?.[1];
      return {
        text,
        style,
        heading: lvl !== undefined ? +lvl < 9 : !!style && styleHeading(style),
        list: /<w:numPr>/.test(p) || (style && /list/i.test(styleMap.get(style)?.name || '')),
        table: !box && inTable(m.index),
        graphic: /<w:drawing\b|<w:pict\b|<w:object\b/.test(p),
        allBold: runs.length > 0 && runs.filter((r) => /<w:t\b/.test(r)).every((r) => /<w:b\/>|<w:b w:val="(?:1|true)"\/>/.test(r)),
        maxSz: Math.max(0, ...[...p.matchAll(/<w:sz w:val="(\d+)"/g)].map((x) => +x[1] / 2)),
        tabs: (p.match(/<w:tab\/>/g) || []).length,
      };
    });
  const paras = parse(doc, false);
  const boxParas = boxes.flatMap((b) => parse(b, true));
  const headings = paras.filter((p) => p.heading).length;
  const fakeHeadings = paras.filter((p) => !p.heading && !p.list && !p.table && p.text.length > 0 && p.text.length < 90 && !/[.:;,]$/.test(p.text.trim()) && (p.allBold || p.maxSz >= bodySz + 3));
  if (fakeHeadings.length) add(headings ? 'WARN' : 'FAIL', 'doc-heading-styles', `${fakeHeadings.length} paragraph(s) look like headings but use no heading style, e.g. "${fakeHeadings[0].text.slice(0, 40)}"${headings ? '' : '; the document has no real headings at all'}`);
  const fakeLists = typedBullets(paras.filter((p) => !p.list).map((p) => p.text));
  if (fakeLists.length) add('WARN', 'fake-bullets', `${fakeLists.length} paragraph(s) start with a typed bullet or number, e.g. "${fakeLists[0].slice(0, 30)}"`);
  let empties = 0, maxEmpties = 0;
  for (const p of paras) (empties = p.text.trim() || p.graphic || p.table ? 0 : empties + 1), (maxEmpties = Math.max(maxEmpties, empties));
  if (maxEmpties >= 3) add('WARN', 'doc-manual-layout', `${maxEmpties} empty paragraphs in a row: use spacing or a page break`);
  const spaced = paras.filter((p) => / {4,}/.test(p.text) || p.tabs >= 3);
  if (spaced.length) add('INFO', 'doc-manual-layout', `${spaced.length} paragraph(s) aligned with runs of spaces or tabs`);
  const tables = tableSpans.length;
  if (/<w:(?:tblW|tcW)\b[^>]*w:type="pct"/.test(doc)) add('INFO', 'doc-table-widths', 'table widths in percent: they break in Google Docs and some converters, use fixed widths');
  if (tables && !/<w:tblHeader\/>|<w:tblHeader w:val="(?:1|true)"\/>/.test(doc)) add('INFO', 'doc-table-widths', `${tables} table(s) without a repeating header row`);
  const pics = [...get('word/document.xml').matchAll(/<wp:docPr\b[^>]*?(?:\/>|>[\s\S]*?<\/wp:docPr>)/g)].map((m) => m[0]);
  const noAlt = pics.filter((t) => !(attr(t, 'descr') || '').trim() && !DECORATIVE.test(t));
  if (noAlt.length) add('WARN', 'doc-alt-text', `${noAlt.length} of ${pics.length} picture(s) without alt text (mark decorative ones as decorative)`);
  if (!pics.length) add('N/A', 'doc-alt-text', 'no pictures in the document');
  if (!tables) add('N/A', 'doc-table-widths', 'no tables in the document');
  const title = decode(core.match(/<dc:title>([^<]*)<\/dc:title>/)?.[1] || '').trim();
  if (!title) add('WARN', 'doc-meta', 'no document title (File → Properties): PDF exports show the file name instead');
  if (!lang) add('INFO', 'doc-meta', 'no default language in styles: spellcheck and screen readers guess');
  if (bodySz < 10) add('WARN', 'doc-type-scale', `body text ${bodySz} pt in the default paragraph style (10–12 pt for print)`);
  const fonts = new Set([...doc.matchAll(/<w:rFonts\b[^>]*w:ascii="([^"]*)"/g), ...styles.matchAll(/<w:rFonts\b[^>]*w:ascii="([^"]*)"/g)].map((m) => m[1]));
  if (fonts.size > 3) add('INFO', 'doc-type-scale', `${fonts.size} font families: ${[...fonts].join(', ')}`);
  for (const p of [...paras, ...boxParas]) if (leftover(p.text)) add('FAIL', 'doc-leftovers', `template leftover "${p.text.slice(0, 40)}"`);
  return { paragraphs: paras.length, textBoxes: boxes.length, headings, tables, pictures: pics.length, bodyPt: bodySz, language: lang || null, title: title || null, fonts: [...fonts] };
}

const out = [];
for (const f of files) {
  const issues = [];
  const add = (level, rule, msg) => issues.push({ level, rule, msg });
  let info = {};
  try {
    const buf = readFileSync(f);
    const z = unzip(buf);
    if (buf.length > 10 * 1024 * 1024) add('WARN', 'doc-weight', `${(buf.length / 1048576).toFixed(1)} MB: heavy for mail and messengers (≲ 5–10 MB); compress pictures (File → Compress) or send a PDF`);
    const ext = extname(f).toLowerCase();
    if (z.has('ppt/presentation.xml')) info = { type: 'pptx', ...pptx(z, add) };
    else if (z.has('word/document.xml')) info = { type: 'docx', ...docx(z, add) };
    else add('FAIL', 'format', `neither a .pptx nor a .docx${ext === '.xlsx' ? ' (.xlsx is not supported yet)' : ''}`);
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
