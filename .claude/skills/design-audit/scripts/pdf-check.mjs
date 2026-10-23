#!/usr/bin/env node
// PDF accessibility and print-readiness check by structure. Node 18+, no dependencies.
// Usage: node pdf-check.mjs <file.pdf>... [--json]
// Rules: documents.md (doc-text-layer, doc-fonts-embedded, doc-tagged, doc-meta, doc-links,
// doc-print-ready). Reads the raw file and inflates Flate streams (including object streams),
// so it sees dictionaries that compressed PDFs hide. It does not render: glyphs that are
// embedded but missing from the font (squares instead of letters) must be checked by eye.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('Usage: node pdf-check.mjs <file.pdf>... [--json]');
  process.exit(2);
}
const STANDARD14 = /^(?:Times-|Helvetica|Courier|Symbol|ZapfDingbats)/;

function analyse(buf) {
  const raw = buf.toString('latin1');
  if (!raw.startsWith('%PDF-')) throw new Error('not a PDF');
  const parts = [raw];
  let flate = 0, failed = 0, textOps = 0;
  for (const m of raw.matchAll(/(<<(?:(?!stream)[\s\S]){0,2000}?>>)\s*stream\r?\n/g)) {
    const dict = m[1];
    const start = m.index + m[0].length;
    const lenMatch = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
    const end = lenMatch ? start + +lenMatch[1] : raw.indexOf('endstream', start);
    if (!/\/FlateDecode/.test(dict) || /\/Subtype\s*\/Image/.test(dict)) continue;
    try {
      const s = inflateSync(buf.subarray(start, end)).toString('latin1');
      flate++;
      parts.push(s);
      if (/\bBT\b[\s\S]*?(?:Tj|TJ|'|")[\s\S]*?\bET\b/.test(s)) textOps++;
    } catch {
      failed++;
    }
  }
  if (/\bBT\b[\s\S]{0,4000}?(?:Tj|TJ)/.test(raw)) textOps++; // uncompressed content streams
  const all = parts.join('\n');
  const info = { version: raw.slice(5, 8), encrypted: /\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</.test(raw) };
  info.pages = (all.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  // fonts
  const fonts = new Map();
  for (const m of all.matchAll(/<<(?:(?!<<)[\s\S]){0,800}?\/Type\s*\/Font\b[\s\S]{0,800}?>>/g)) {
    const d = m[0];
    const name = d.match(/\/BaseFont\s*\/([^\s/<>\[\]]+)/)?.[1];
    const sub = d.match(/\/Subtype\s*\/(\w+)/)?.[1];
    if (name && sub !== 'Type0') fonts.set(name, { sub, embedded: false });
    if (name && sub === 'Type0' && !fonts.has(name)) fonts.set(name, { sub, embedded: null });
  }
  for (const m of all.matchAll(/<<(?:(?!<<)[\s\S]){0,1500}?\/Type\s*\/FontDescriptor\b[\s\S]{0,1500}?>>/g)) {
    const d = m[0];
    const name = d.match(/\/FontName\s*\/([^\s/<>\[\]]+)/)?.[1];
    const emb = /\/FontFile[23]?\s/.test(d);
    if (name) fonts.set(name, { ...(fonts.get(name) || {}), embedded: emb });
  }
  for (const [n, f] of fonts) if (f.sub === 'Type3') f.embedded = true;
  info.fonts = [...fonts].map(([n, f]) => `${n}${f.embedded ? '' : f.embedded === false ? ' (not embedded)' : ''}`);
  info.images = [...all.matchAll(/\/Subtype\s*\/Image\b[\s\S]{0,400}?>>/g)].map((m) => {
    const w = +(m[0].match(/\/Width\s+(\d+)/)?.[1] || 0), h = +(m[0].match(/\/Height\s+(\d+)/)?.[1] || 0);
    return { w, h };
  });
  // also scan dictionaries preceding image streams (Width may come before Subtype)
  for (const m of raw.matchAll(/<<([\s\S]{0,600}?)>>\s*stream/g)) {
    if (/\/Subtype\s*\/Image/.test(m[1]) && !info.images.length) {
      info.images.push({ w: +(m[1].match(/\/Width\s+(\d+)/)?.[1] || 0), h: +(m[1].match(/\/Height\s+(\d+)/)?.[1] || 0) });
    }
  }
  info.textStreams = textOps;
  info.tagged = /\/MarkInfo\s*<<[^>]*\/Marked\s+true/.test(all) && /\/StructTreeRoot\s+\d+\s+\d+\s+R/.test(all);
  info.lang = all.match(/\/Lang\s*\(([^)]*)\)/)?.[1] || null;
  // text strings are PDFDocEncoding or UTF-16BE with a byte order mark (þÿ)
  const pdfString = (s) => (s && s.startsWith('\xfe\xff') ? Buffer.from(s.slice(2), 'latin1').swap16().toString('utf16le') : s);
  info.title = pdfString(all.match(/\/Title\s*\(([^)]*)\)/)?.[1]) || all.match(/<dc:title>[\s\S]*?<rdf:li[^>]*>([^<]*)</)?.[1] || null;
  info.displayTitle = /\/DisplayDocTitle\s+true/.test(all);
  info.links = (all.match(/\/Subtype\s*\/Link\b/g) || []).length;
  info.figuresWithAlt = (all.match(/\/S\s*\/Figure[\s\S]{0,300}?\/Alt\s*\(/g) || []).length;
  info.figures = (all.match(/\/S\s*\/Figure\b/g) || []).length;
  info.streams = { inflated: flate, failed };
  return info;
}

const out = [];
for (const f of files) {
  const issues = [];
  const add = (level, rule, msg) => issues.push({ level, rule, msg });
  let info = {};
  try {
    info = analyse(readFileSync(f));
    if (info.encrypted) add('INFO', 'doc-meta', 'encrypted: content streams may be unreadable, results are partial');
    if (!info.fonts.length && info.images.length) add('FAIL', 'doc-text-layer', 'no fonts but images present: looks like a scan without OCR, text cannot be selected, searched or read aloud');
    else if (!info.textStreams && !info.fonts.length) add('FAIL', 'doc-text-layer', 'no text found');
    const notEmb = info.fonts.filter((n) => n.endsWith('(not embedded)'));
    for (const n of notEmb) add(STANDARD14.test(n) ? 'WARN' : 'FAIL', 'doc-fonts-embedded', `font ${n.replace(' (not embedded)', '')} is not embedded${STANDARD14.test(n) ? ': a base-14 font has no Cyrillic or Kazakh letters' : ': another machine will substitute it'}`);
    if (!info.tagged) add('WARN', 'doc-tagged', 'not tagged: no structure or reading order for screen readers (PDF/UA)');
    if (info.figures && info.figuresWithAlt < info.figures) add('WARN', 'doc-alt-text', `${info.figures - info.figuresWithAlt} of ${info.figures} tagged figure(s) without /Alt`);
    if (!info.lang) add('WARN', 'doc-meta', 'no document language (/Lang)');
    if (!info.title) add('WARN', 'doc-meta', 'no document title: viewers show the file name');
    else if (!info.displayTitle) add('INFO', 'doc-meta', 'title set but DisplayDocTitle is off: the window shows the file name');
    const small = info.images.filter((i) => i.w && i.w < 600);
    if (small.length) add('INFO', 'doc-print-ready', `${small.length} image(s) under 600 px wide: check they print ≥ 300 dpi at their placed size`);
    if (info.streams.failed) add('INFO', 'format', `${info.streams.failed} stream(s) could not be inflated`);
  } catch (e) {
    add('FAIL', 'format', e.message);
  }
  out.push({ file: f, ...info, issues });
}
if (args.includes('--json')) console.log(JSON.stringify(out, null, 2));
else
  for (const r of out) {
    const { file, issues, images, ...info } = r;
    console.log(`${basename(file)}  ${JSON.stringify({ ...info, images: images?.length })}`);
    for (const i of issues) console.log(`  ${i.level.padEnd(4)} ${i.rule.padEnd(20)} ${i.msg}`);
  }
process.exit(out.some((r) => r.issues.some((i) => i.level === 'FAIL')) ? 1 : 0);
