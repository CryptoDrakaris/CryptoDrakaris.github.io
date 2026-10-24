#!/usr/bin/env node
// PDF accessibility and print-readiness check by structure. Node 18+, no dependencies.
// Usage: node pdf-check.mjs <file.pdf>... [--json] [--extract-images <dir>]
// --extract-images writes embedded JPEG images (DCTDecode) as files: when pages are flat
// images (exported slides, scans) they can be reviewed by eye without a PDF renderer.
// With several PDFs each file's images are prefixed with its name.
// Rules: documents.md (doc-text-layer, doc-fonts-embedded, doc-tagged, doc-meta, doc-alt-text,
// doc-print-ready, doc-weight; doc-links as a count); `format` – the file cannot be read.
// Reads the raw file, resolves indirect /Length, inflates Flate streams (including object streams), so it sees dictionaries that
// compressed PDFs hide; the title comes from the trailer's /Info, then XMP. It does not render:
// glyphs that are embedded but missing from the font (squares instead of letters) must be
// checked by eye. Encrypted files are read only as far as their structure is plain.
// Levels: FAIL, WARN, INFO and N/A – the rule had nothing to check in this file (no images,
// no tagged figures): N/A is not a pass, report it apart from what was checked and found fine.
// Exit code: 0 no FAIL, 1 at least one FAIL, 2 bad input.
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { basename, join } from 'node:path';

const USAGE = 'Usage: node pdf-check.mjs <file.pdf>... [--json] [--extract-images <dir>]';
const fail = (msg) => {
  console.error(`Error: ${msg}\n${USAGE}`);
  process.exit(2);
};
const args = process.argv.slice(2);
let extractDir = null, asJson = false;
const files = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--json') asJson = true;
  else if (a === '--extract-images') {
    if (!args[i + 1] || args[i + 1].startsWith('-')) fail('--extract-images needs a folder');
    extractDir = args[++i];
  } else if (a === '--help' || a === '-h') {
    console.log(USAGE);
    process.exit(0);
  } else if (a.startsWith('-')) fail(`unknown option ${a}`);
  else files.push(a);
}
if (!files.length) fail('no PDF given');
for (const f of files) {
  let s = null;
  try {
    s = statSync(f);
  } catch {}
  if (!s || !s.isFile()) fail(`${f} ${s ? 'is not a file' : 'does not exist'}`);
}
const STANDARD14 = /^(?:Times-|Helvetica|Courier|Symbol|ZapfDingbats)/;

// ---------- PDF strings ----------
// literal (…) with escapes \n \( \) \\ \ddd and nested parentheses; hex <…>
function readString(s, i) {
  if (s[i] === '(') {
    let out = '', depth = 1;
    for (i++; i < s.length && depth; i++) {
      const c = s[i];
      if (c === '\\') {
        const d = s[++i];
        const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
        if (map[d] !== undefined) out += map[d];
        else if (/[0-7]/.test(d)) {
          let oct = d;
          while (oct.length < 3 && /[0-7]/.test(s[i + 1])) oct += s[++i];
          out += String.fromCharCode(parseInt(oct, 8) & 255);
        } else if (d === '\r' && s[i + 1] === '\n') i++; // line continuation
        else if (d !== '\n' && d !== '\r') out += d;
        continue;
      }
      if (c === '(') depth++;
      if (c === ')' && --depth === 0) break;
      out += c;
    }
    return out;
  }
  const end = s.indexOf('>', i);
  const h = s.slice(i + 1, end < 0 ? undefined : end).replace(/[^0-9a-f]/gi, '');
  return Buffer.from(h.length % 2 ? h + '0' : h, 'hex').toString('latin1');
}
// text strings are PDFDocEncoding or UTF-16BE with a byte order mark (þÿ)
const textOf = (s) => {
  if (s == null) return s;
  if (s.startsWith('\xfe\xff')) return Buffer.from(s.slice(2), 'latin1').swap16().toString('utf16le').replace(/\0/g, '');
  if (s.startsWith('\xef\xbb\xbf')) return Buffer.from(s.slice(3), 'latin1').toString('utf8');
  const utf8 = Buffer.from(s, 'latin1').toString('utf8'); // some exporters write raw UTF-8 bytes
  return /[^\x00-\x7f]/.test(s) && !utf8.includes('�') ? utf8 : s;
};

function analyse(buf) {
  const raw = buf.toString('latin1');
  const head = raw.indexOf('%PDF-');
  if (head < 0 || head > 1024) throw new Error('not a PDF');
  const info = { version: raw.slice(head + 5, head + 8), encrypted: /\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</.test(raw) };
  if (!/%%EOF\s*$/.test(raw.slice(-1024))) info.truncated = true;

  // ---- objects: the last definition wins (incremental updates append new versions)
  const objs = new Map();
  const starts = [...raw.matchAll(/(?<![\d.])(\d+)\s+(\d+)\s+obj\b/g)];
  starts.forEach((m, k) => {
    const from = m.index + m[0].length;
    const next = k + 1 < starts.length ? starts[k + 1].index : raw.length;
    const end = raw.indexOf('endobj', from);
    const body = raw.slice(from, end >= 0 && end < next ? end : next);
    const sm = body.match(/^\s*(<<[\s\S]*?>>)\s*stream\r?\n/);
    objs.set(m[1], sm ? { dict: sm[1], start: from + sm[0].length, guessEnd: from + body.lastIndexOf('endstream') } : { dict: body.trim() });
  });
  const valueAfter = (dict, key) => {
    const m = dict.match(new RegExp(`/${key}(?![\\w#])\\s*`));
    if (!m) return null;
    const i = m.index + m[0].length;
    const c = dict[i];
    if (c === '(' || (c === '<' && dict[i + 1] !== '<')) return { str: readString(dict, i) };
    const ref = dict.slice(i).match(/^(\d+)\s+(\d+)\s+R\b/);
    if (ref) return { ref: ref[1] };
    const tok = dict.slice(i).match(/^(\/[^\s/<>\[\]()]+|<<[\s\S]*?>>|-?[\d.]+|true|false)/);
    return tok ? { tok: tok[1] } : null;
  };
  const resolve = (v, depth = 0) => {
    if (!v || !v.ref || depth > 5) return v;
    const o = objs.get(v.ref);
    if (!o) return null;
    const d = o.dict.trim();
    if (d.startsWith('(') || (d.startsWith('<') && !d.startsWith('<<'))) return { str: readString(d, 0) };
    const ref = d.match(/^(\d+)\s+(\d+)\s+R\b/);
    if (ref) return resolve({ ref: ref[1] }, depth + 1);
    return { tok: d.match(/^\S+/)?.[0], dict: d };
  };
  const lengthOf = (o) => {
    const v = resolve(valueAfter(o.dict, 'Length'));
    const n = v && v.tok && +v.tok;
    return Number.isFinite(n) && n >= 0 && o.start + n <= raw.length ? n : Math.max(0, o.guessEnd - o.start);
  };

  // ---- streams
  const parts = [raw];
  let flate = 0, failed = 0, textOps = 0;
  for (const [num, o] of [...objs]) {
    if (o.start === undefined || !/\/FlateDecode/.test(o.dict) || /\/Subtype\s*\/Image/.test(o.dict)) continue;
    let s;
    try {
      s = inflateSync(buf.subarray(o.start, o.start + lengthOf(o))).toString('latin1');
    } catch {
      failed++;
      continue;
    }
    flate++;
    parts.push(s);
    if (/\bBT\b[\s\S]*?(?:Tj|TJ|'|")[\s\S]*?\bET\b/.test(s)) textOps++;
    // an object stream holds dictionaries: index them too
    if (/\/Type\s*\/ObjStm/.test(o.dict)) {
      const first = +(o.dict.match(/\/First\s+(\d+)/)?.[1] || 0), n = +(o.dict.match(/\/N\s+(\d+)/)?.[1] || 0);
      const nums = s.slice(0, first).trim().split(/\s+/).map(Number);
      for (let k = 0; k < n; k++) {
        const at = first + nums[2 * k + 1], to = k + 1 < n ? first + nums[2 * k + 3] : s.length;
        if (!objs.has(String(nums[2 * k]))) objs.set(String(nums[2 * k]), { dict: s.slice(at, to).trim() });
      }
    }
  }
  // uncompressed content streams; random bytes elsewhere in the file can spell BT … Tj by chance
  for (const [, o] of objs)
    if (o.start !== undefined && !/\/Filter\b/.test(o.dict) && /\bBT\b[\s\S]{0,4000}?(?:Tj|TJ)/.test(raw.slice(o.start, o.start + Math.min(lengthOf(o), 1 << 20)))) {
      textOps++;
      break;
    }
  const all = parts.join('\n');
  // pages counted once per object, so rewritten pages of an incremental update do not double
  const pageObjs = [...objs.values()].filter((o) => /\/Type\s*\/Page(?![s\w])/.test(o.dict)).length;
  info.pages = pageObjs || (all.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;

  // fonts
  const fonts = new Map();
  let type3 = 0;
  for (const m of all.matchAll(/<<(?:(?!<<)[\s\S]){0,800}?\/Type\s*\/Font\b[\s\S]{0,800}?>>/g)) {
    const d = m[0];
    const name = d.match(/\/BaseFont\s*\/([^\s/<>\[\]]+)/)?.[1];
    const sub = d.match(/\/Subtype\s*\/(\w+)/)?.[1];
    if (sub === 'Type3' && !name) fonts.set(`Type3 font ${++type3}`, { sub, embedded: true }); // glyphs drawn in the PDF itself
    if (name && sub !== 'Type0') fonts.set(name, { sub, embedded: false });
    if (name && sub === 'Type0' && !fonts.has(name)) fonts.set(name, { sub, embedded: null });
  }
  for (const m of all.matchAll(/<<(?:(?!<<)[\s\S]){0,1500}?\/Type\s*\/FontDescriptor\b[\s\S]{0,1500}?>>/g)) {
    const d = m[0];
    const name = d.match(/\/FontName\s*\/([^\s/<>\[\]]+)/)?.[1];
    const emb = /\/FontFile[23]?\s/.test(d);
    if (name) fonts.set(name, { ...(fonts.get(name) || {}), embedded: emb });
  }
  for (const [, f] of fonts) if (f.sub === 'Type3') f.embedded = true;
  // a descriptor without a font file is fine when a Type3 font uses it: Type3 glyphs are drawn
  // in the PDF itself (Canva exports some fonts this way)
  const type3Descriptors = new Set([...raw.matchAll(/\/Subtype\s*\/Type3[\s\S]{0,1500}?\/FontDescriptor\s+(\d+)\s+0\s+R/g)].map((m) => m[1]));
  for (const m of raw.matchAll(/(\d+)\s+0\s+obj\s*<<[\s\S]{0,300}?\/Type\s*\/FontDescriptor[\s\S]{0,800}?\/FontName\s*\/([^\s/<>\[\]]+)/g))
    if (type3Descriptors.has(m[1]) && fonts.has(m[2])) fonts.get(m[2]).embedded = true;
  info.fonts = [...fonts].map(([n, f]) => `${n}${f.embedded ? '' : f.embedded === false ? ' (not embedded)' : ''}`);
  const images = [...objs.entries()].filter(([, o]) => /\/Subtype\s*\/Image\b/.test(o.dict));
  info.images = images.map(([, o]) => ({ w: +(o.dict.match(/\/Width\s+(\d+)/)?.[1] || 0), h: +(o.dict.match(/\/Height\s+(\d+)/)?.[1] || 0) }));
  info.textStreams = textOps;

  // catalog and document information
  // newest first: classic trailers and cross-reference stream dictionaries
  const trailers = [...raw.matchAll(/trailer\s*(<<[\s\S]*?>>)\s*startxref/g)].map((m) => m[1]).concat([...objs.values()].filter((o) => /\/Type\s*\/XRef/.test(o.dict)).map((o) => o.dict)).reverse();
  const fromTrailers = (key) => {
    for (const t of trailers) {
      const v = valueAfter(t, key);
      if (v) return resolve(v);
    }
    return null;
  };
  const catalog = fromTrailers('Root')?.dict ?? [...objs.values()].find((o) => /\/Type\s*\/Catalog/.test(o.dict))?.dict ?? '';
  const infoDict = fromTrailers('Info')?.dict ?? '';
  const str = (dict, key) => {
    const v = resolve(valueAfter(dict, key));
    return v && v.str !== undefined ? textOf(v.str) : null;
  };
  // MarkInfo may be inline or a reference to an object holding /Marked true
  info.tagged = /\/Marked\s+true/.test(all) && /\/StructTreeRoot\s+\d+\s+\d+\s+R/.test(all);
  if (info.encrypted) {
    // strings of an encrypted file are encrypted too: title and language cannot be read
    info.lang = info.title = 'unreadable (encrypted)';
  } else {
    info.lang = str(catalog, 'Lang') || null;
    const xmp = all.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]*)</)?.[1];
    info.title = str(infoDict, 'Title') || (xmp ? Buffer.from(xmp, 'latin1').toString('utf8').trim() : null) || null; // XMP is UTF-8 read as latin1
  }
  info.displayTitle = /\/DisplayDocTitle\s+true/.test(all);
  info.links = (all.match(/\/Subtype\s*\/Link\b/g) || []).length;
  info.figuresWithAlt = (all.match(/\/S\s*\/Figure[\s\S]{0,300}?\/Alt\s*[(<]/g) || []).length;
  info.figures = (all.match(/\/S\s*\/Figure\b/g) || []).length;
  info.streams = { inflated: flate, failed };
  // OCR engines (Tesseract, macOS Preview) draw recognised text invisibly in a "GlyphLessFont"
  info.ocrLayer = info.fonts.some((n) => /glyph ?less/i.test(n));
  info.imagePages = info.images.length >= info.pages && info.pages > 0 && info.fonts.length <= 1;
  info.extractable = images.filter(([, o]) => /\/DCTDecode/.test(o.dict) && o.start !== undefined).map(([, o]) => buf.subarray(o.start, o.start + lengthOf(o)));
  return info;
}

const out = [];
for (const f of files) {
  const issues = [];
  const add = (level, rule, msg) => issues.push({ level, rule, msg });
  let info = {};
  try {
    const buf = readFileSync(f);
    info = { kb: Math.round(buf.length / 1024), ...analyse(buf) };
    if (buf.length > 10 * 1024 * 1024) add('WARN', 'doc-weight', `${(buf.length / 1048576).toFixed(1)} MB: heavy for mail and messengers (≲ 5–10 MB); compress the images or export text as text`);
    const jpegs = info.extractable;
    delete info.extractable;
    if (extractDir) {
      mkdirSync(extractDir, { recursive: true });
      const prefix = files.length > 1 ? `${basename(f).replace(/\.pdf$/i, '')}-` : '';
      jpegs.forEach((b, k) => writeFileSync(join(extractDir, `${prefix}image-${String(k + 1).padStart(3, '0')}.jpg`), b));
      info.extracted = jpegs.length;
    }
    if (info.truncated) add('WARN', 'format', 'no %%EOF at the end: the file looks truncated or still being written, results are partial');
    if (info.encrypted) add('INFO', 'doc-meta', 'encrypted: title, language and compressed content cannot be read, those checks are skipped');
    if (info.ocrLayer && info.imagePages) add('WARN', 'doc-text-layer', `every page is a picture (${info.images.length} images on ${info.pages} pages) with an invisible OCR text layer: text is not real, search and copy depend on recognition quality, the file is heavy; export text as text from the source`);
    const textLevel = info.encrypted ? 'INFO' : 'FAIL';
    if (!info.fonts.length && !info.textStreams && info.images.length) add(textLevel, 'doc-text-layer', 'no fonts and no text, only images: looks like a scan without OCR, text cannot be selected, searched or read aloud');
    else if (!info.textStreams && !info.fonts.length) add(textLevel, 'doc-text-layer', 'no text found');
    const notEmb = info.fonts.filter((n) => n.endsWith('(not embedded)'));
    for (const n of notEmb) add(STANDARD14.test(n) ? 'WARN' : 'FAIL', 'doc-fonts-embedded', `font ${n.replace(' (not embedded)', '')} is not embedded${STANDARD14.test(n) ? ': a base-14 font has no Cyrillic or Kazakh letters' : ': another machine will substitute it'}`);
    if (!info.tagged) add('WARN', 'doc-tagged', 'not tagged: no structure or reading order for screen readers (PDF/UA)');
    if (info.figures && info.figuresWithAlt < info.figures) add('WARN', 'doc-alt-text', `${info.figures - info.figuresWithAlt} of ${info.figures} tagged figure(s) without /Alt`);
    if (!info.encrypted) {
      if (!info.lang) add('WARN', 'doc-meta', 'no document language (/Lang)');
      if (!info.title) add('WARN', 'doc-meta', 'no document title: viewers show the file name');
      else if (!info.displayTitle) add('INFO', 'doc-meta', 'title set but DisplayDocTitle is off: the window shows the file name');
    }
    if (info.tagged && !info.figures) add('N/A', 'doc-alt-text', 'no tagged figures: nothing carries /Alt (pictures outside the tags are a doc-tagged question)');
    if (!info.images.length) add('N/A', 'doc-print-ready', 'no images: image resolution does not apply');
    const small = info.images.filter((i) => i.w && i.w < 600);
    if (small.length) add('INFO', 'doc-print-ready', `${small.length} image(s) under 600 px wide: check they print ≥ 300 dpi at their placed size`);
    if (info.streams.failed && !info.encrypted) add('INFO', 'format', `${info.streams.failed} stream(s) could not be inflated`);
  } catch (e) {
    add('FAIL', 'format', e.message);
  }
  out.push({ file: f, ...info, issues });
}
if (asJson) console.log(JSON.stringify(out, null, 2));
else
  for (const r of out) {
    const { file, issues, images, ...info } = r;
    console.log(`${basename(file)}  ${JSON.stringify({ ...info, images: images?.length })}`);
    for (const i of issues) console.log(`  ${i.level.padEnd(4)} ${i.rule.padEnd(20)} ${i.msg}`);
  }
process.exit(out.some((r) => r.issues.some((i) => i.level === 'FAIL')) ? 1 : 0);
