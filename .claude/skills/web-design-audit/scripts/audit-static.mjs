#!/usr/bin/env node
// Static web design audit over built HTML + CSS. No dependencies, Node 18+.
// Usage: node audit-static.mjs <build-dir> [--css extra.css ...] [--json]
// Heuristic regex parsing: confirm CRITICAL/HIGH findings against source before reporting.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const json = args.includes('--json');
const extraCss = [];
let root = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--css') extraCss.push(args[++i]);
  else if (args[i] !== '--json') root = args[i];
}
if (!root) {
  console.error('Usage: node audit-static.mjs <build-dir> [--css file.css] [--json]');
  process.exit(2);
}

// ---------- helpers ----------
async function walk(dir, exts, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, exts, out);
    else if (exts.includes(path.extname(e.name))) out.push(p);
  }
  return out;
}

const findings = new Map(); // key -> {id, severity, message, pages:Set, sample}
function add(id, severity, message, page, sample = '') {
  const key = `${id}|${message}|${sample}`;
  if (!findings.has(key)) findings.set(key, { id, severity, message, pages: new Set(), sample });
  findings.get(key).pages.add(page);
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
};
const hasAttr = (tag, name) => new RegExp(`\\s${name}(\\s|=|>|/)`, 'i').test(tag);
const stripTags = (s) => s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').trim();
const short = (s, n = 110) => s.replace(/\s+/g, ' ').slice(0, n);

// ---------- color ----------
function hexToRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lum = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(hexToRgb(a)), lum(hexToRgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

// ---------- HTML checks ----------
const htmlFiles = await walk(root, ['.html']);
if (!htmlFiles.length) {
  console.error(`No .html files in ${root}. Build the project first.`);
  process.exit(2);
}
const cssChunks = [];
const titles = new Map();

for (const file of htmlFiles) {
  const page = '/' + path.relative(root, file).replace(/\\/g, '/').replace(/index\.html$/, '');
  const html = await readFile(file, 'utf8');
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) cssChunks.push(m[1]);

  const isRedirect = /http-equiv\s*=\s*["']?refresh/i.test(html);
  const htmlTag = html.match(/<html[^>]*>/i)?.[0] ?? '';

  // html-lang
  if (!attr(htmlTag, 'lang')) add('html-lang', 'HIGH', '<html> без атрибута lang', page);

  // viewport-meta
  const vp = html.match(/<meta[^>]+name\s*=\s*["']viewport["'][^>]*>/i)?.[0];
  if (!vp && !isRedirect) add('viewport-meta', 'CRITICAL', 'Нет meta viewport', page);
  else if (vp) {
    const c = attr(vp, 'content') || '';
    if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(c))
      add('viewport-meta', 'CRITICAL', 'Масштабирование отключено в meta viewport', page, c);
  }

  // meta
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  if (!title) add('meta-title', 'HIGH', 'Пустой или отсутствующий <title>', page);
  else {
    // duplicates only matter within one language version
    const key = `${attr(htmlTag, 'lang') ?? ''}|${title}`;
    if (!isRedirect) titles.set(key, [...(titles.get(key) ?? []), page]);
    if (title.length > 65) add('meta-title', 'LOW', 'Title длиннее 65 символов', page, title);
  }
  if (isRedirect) {
    if (!/name\s*=\s*["']robots["'][^>]*noindex/i.test(html)) add('redirect-pages', 'LOW', 'Страница-редирект без noindex', page);
  } else {
    if (!/<meta[^>]+name\s*=\s*["']description["']/i.test(html)) add('meta-description', 'MEDIUM', 'Нет meta description', page);
    if (!/rel\s*=\s*["']canonical["']/i.test(html)) add('canonical', 'LOW', 'Нет link rel=canonical', page);
    for (const p of ['og:title', 'og:description']) if (!new RegExp(`property\\s*=\\s*["']${p}["']`, 'i').test(html)) add('open-graph', 'MEDIUM', `Нет ${p}`, page);
    if (!/property\s*=\s*["']og:image["']/i.test(html)) add('open-graph', 'LOW', 'Нет og:image', page);
    const og = html.match(/property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)/i)?.[1];
    if (og && !/^https?:\/\//.test(og)) add('open-graph', 'MEDIUM', 'og:image не абсолютный URL', page, og);
    if (!/rel\s*=\s*["'][^"']*icon/i.test(html)) add('favicon', 'LOW', 'Нет favicon', page);
    const hreflangs = [...html.matchAll(/hreflang\s*=\s*["']([^"']+)/gi)].map((m) => m[1]);
    for (const h of new Set(hreflangs)) if (/^kz$/i.test(h)) add('hreflang', 'MEDIUM', 'Код языка kz вместо kk', page);
  }

  if (isRedirect) continue;

  // landmarks & skip link
  if (!/<main[\s>]/i.test(html)) add('landmarks', 'MEDIUM', 'Нет <main>', page);
  const navs = [...html.matchAll(/<nav[^>]*>/gi)].map((m) => m[0]);
  if (navs.length > 1 && navs.some((n) => !attr(n, 'aria-label') && !attr(n, 'aria-labelledby')))
    add('landmarks', 'LOW', 'Несколько <nav> без aria-label', page);
  const body = html.slice(html.search(/<body[^>]*>/i));
  const firstLink = body.match(/<a\s[^>]*>/i)?.[0] ?? '';
  if (!/href\s*=\s*["']#/.test(firstLink)) add('skip-links', 'MEDIUM', 'Первая ссылка на странице не скип-ссылка к контенту', page);

  // headings
  const hs = [...body.matchAll(/<h([1-6])[\s>]/gi)].map((m) => +m[1]);
  const h1 = hs.filter((l) => l === 1).length;
  if (h1 === 0) add('heading-hierarchy', 'MEDIUM', 'Нет h1', page);
  if (h1 > 1) add('heading-hierarchy', 'MEDIUM', `h1 на странице: ${h1}`, page);
  for (let i = 1; i < hs.length; i++)
    if (hs[i] > hs[i - 1] + 1) {
      add('heading-hierarchy', 'MEDIUM', `Пропуск уровня заголовка h${hs[i - 1]} → h${hs[i]}`, page);
      break;
    }

  // images
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = attr(tag, 'src') ?? '';
    const sample = src.split('/').slice(-2).join('/');
    if (!hasAttr(tag, 'alt')) add('alt-text', 'CRITICAL', '<img> без атрибута alt', page, sample);
    if (!attr(tag, 'width') || !attr(tag, 'height')) add('image-dimension', 'HIGH', '<img> без width/height (риск CLS)', page, sample);
    if (/\.(png|jpe?g|gif)(\?|$)/i.test(src)) add('image-optimization', 'MEDIUM', 'Растровое изображение не в WebP/AVIF', page, sample);
  }

  // interactive names
  for (const m of body.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const [whole, tagName, attrs, inner] = m;
    const open = `<${tagName}${attrs}>`;
    if (tagName.toLowerCase() === 'a' && attr(open, 'aria-hidden') === 'true') continue;
    const text = stripTags(inner);
    const imgAlt = [...inner.matchAll(/<img\b[^>]*>/gi)].some((i) => (attr(i[0], 'alt') ?? '').trim());
    const named = text || imgAlt || attr(open, 'aria-label') || attr(open, 'aria-labelledby') || attr(open, 'title') || /class\s*=\s*["'][^"']*(sr-only|visually-hidden)/.test(inner);
    if (!named) add('aria-labels', 'CRITICAL', `<${tagName}> без доступного имени`, page, short(whole));
    if (tagName.toLowerCase() === 'a') {
      if (attr(open, 'target') === '_blank' && !/noopener|noreferrer/.test(attr(open, 'rel') ?? ''))
        add('external-links', 'LOW', 'target=_blank без rel=noopener', page, attr(open, 'href') ?? '');
      if (!hasAttr(open, 'href')) add('semantic-controls', 'MEDIUM', '<a> без href (использовать <button>)', page, short(whole));
    }
  }
  for (const m of body.matchAll(/<(div|span|li|img)\b[^>]*\sonclick\s*=/gi))
    add('semantic-controls', 'HIGH', `onclick на <${m[1]}> вместо <button>/<a>`, page);
  for (const m of body.matchAll(/<svg\b[^>]*>/gi)) {
    const tag = m[0];
    if (attr(tag, 'aria-hidden') !== 'true' && !attr(tag, 'role') && !attr(tag, 'aria-label'))
      add('icon-context', 'LOW', '<svg> без aria-hidden или role="img"+aria-label', page);
  }

  // forms
  const labelsFor = new Set([...body.matchAll(/<label\b[^>]*\sfor\s*=\s*["']([^"']+)/gi)].map((m) => m[1]));
  for (const m of body.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
    const tag = m[0];
    const type = (attr(tag, 'type') ?? '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
    const before = body.slice(0, m.index);
    const wrapped = before.lastIndexOf('<label') > before.lastIndexOf('</label>');
    const id = attr(tag, 'id');
    if (!wrapped && !(id && labelsFor.has(id)) && !attr(tag, 'aria-label') && !attr(tag, 'aria-labelledby'))
      add('input-labels', 'CRITICAL', `<${m[1]}> без подписи`, page, short(tag));
    if (m[1].toLowerCase() === 'input' && /^(email|phone|tel|name|fname|lname|username)$/i.test(attr(tag, 'name') ?? '') && !attr(tag, 'autocomplete'))
      add('input-type-keyboard', 'MEDIUM', 'Поле без autocomplete', page, attr(tag, 'name'));
  }

  // duplicate ids
  const ids = [...body.matchAll(/\sid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  for (const d of new Set(dup)) add('keyboard-nav', 'MEDIUM', 'Повторяющийся id', page, d);

  // scripts
  for (const m of html.matchAll(/<script\b[^>]*\ssrc\s*=\s*["'](https?:[^"']+)["'][^>]*>/gi))
    if (!/\s(async|defer)\b|type\s*=\s*["']module/i.test(m[0])) add('third-party-scripts', 'MEDIUM', 'Внешний скрипт без async/defer', page, m[1]);

  // fonts
  for (const m of html.matchAll(/href\s*=\s*["'](https:\/\/fonts\.googleapis\.com[^"']+)/gi))
    if (!/display=(swap|optional|fallback)/.test(m[1])) add('font-loading', 'MEDIUM', 'Google Fonts без display=swap', page);
  if (/fonts\.googleapis\.com/.test(html) && !/rel\s*=\s*["']preconnect["'][^>]*fonts\.gstatic\.com|fonts\.gstatic\.com[^>]*rel\s*=\s*["']preconnect/i.test(html))
    add('font-loading', 'LOW', 'Нет preconnect к fonts.gstatic.com', page);
}

for (const [k, pages] of titles) if (pages.length > 1) for (const p of pages) add('meta-title', 'MEDIUM', 'Title повторяется на нескольких страницах одного языка', p, k.split('|').slice(1).join('|'));

// ---------- CSS checks ----------
for (const f of await walk(root, ['.css'])) cssChunks.push(await readFile(f, 'utf8'));
for (const f of extraCss) cssChunks.push(await readFile(f, 'utf8'));
const css = cssChunks.join('\n');
const CSS = 'CSS';

if (/(transition|animation)\s*:/.test(css) && !/prefers-reduced-motion\s*:\s*reduce/.test(css))
  add('reduced-motion', 'HIGH', 'Есть transition/animation, но нет @media (prefers-reduced-motion: reduce)', CSS);
for (const m of css.matchAll(/([^{}]+)\{[^}]*outline\s*:\s*(none|0)\b[^}]*\}/g)) {
  const sel = m[1].trim();
  if (!/focus-visible/.test(css)) add('focus-states', 'HIGH', 'outline: none без правил :focus-visible', CSS, short(sel, 80));
}
if (!/:focus-visible|:focus\b/.test(css)) add('focus-states', 'MEDIUM', 'В CSS нет стилей :focus-visible / :focus (проверить дефолтный фокус)', CSS);
for (const m of css.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) if (+m[1] < 12) add('readable-font-size', 'MEDIUM', `font-size ${m[1]}px < 12px`, CSS);
for (const m of css.matchAll(/font-size\s*:\s*(0?\.\d+)rem/g)) if (+m[1] * 16 < 11.5) add('readable-font-size', 'MEDIUM', `font-size ${m[1]}rem ≈ ${(+m[1] * 16).toFixed(1)}px < 12px`, CSS);
for (const m of css.matchAll(/transition\s*:[^;}]*\b(width|height|top|left|right|bottom|margin[\w-]*|padding[\w-]*)\b/g))
  add('transform-performance', 'MEDIUM', `transition по свойству ${m[1]}`, CSS);
for (const m of css.matchAll(/z-index\s*:\s*(\d+)/g)) if (+m[1] >= 1000) add('z-index-management', 'LOW', `z-index: ${m[1]}`, CSS);
if (/(^|[^-\w])100vh/.test(css)) add('viewport-units', 'LOW', '100vh (на мобильном лучше svh/dvh)', CSS);
const rawHex = (css.match(/(?<!--[\w-]+\s*:\s*)#[0-9a-f]{3,8}\b/gi) ?? []).length;
const tokenDefs = (css.match(/--[\w-]+\s*:\s*#[0-9a-f]{3,8}/gi) ?? []).length;
if (rawHex > Math.max(12, tokenDefs * 1.5)) add('color-semantic', 'LOW', `Много сырых hex вне токенов: ${rawHex} (токенов: ${tokenDefs})`, CSS);

// Contrast matrix per token set: :root and every [data-theme='x'] block (themed sites define one set per theme).
const themeBlocks = new Map();
for (const block of css.matchAll(/(:root|\[data-theme=['"]?([\w-]+)['"]?\])(?::lang\([\w-]+\))?\s*\{([^}]*)\}/g)) {
  const name = block[2] ?? 'root';
  const set = themeBlocks.get(name) ?? {};
  for (const m of block[3].matchAll(/--([\w-]+)\s*:\s*(#[0-9a-f]{3,8})\b/gi)) set[m[1]] ??= m[2];
  themeBlocks.set(name, set);
}
const rootTokens = themeBlocks.get('root') ?? {};
const isBg = (n) => /(^|-)(bg|background|surface|card|base|ground|canvas|paper|backdrop)(-|$|\d)/i.test(n);
// "On-color" tokens (--gold-ink, --primary-foreground, --on-primary) are text placed ON their base color.
const onBase = (n) => n.match(/^(.+)-(ink|fg|foreground|contrast)$/)?.[1] ?? n.match(/^on-(.+)$/)?.[1] ?? null;
const usedAsText = (n) => new RegExp(`(^|[^-\\w])color\\s*:[^;}]*var\\(--${n}\\b`).test(css);
const contrast = [];
for (const [theme, own] of themeBlocks) {
  // a theme inherits tokens it does not redefine
  const tokens = theme === 'root' ? own : { ...rootTokens, ...own };
  const bgs = Object.entries(tokens).filter(([n]) => isBg(n));
  const fgs = Object.entries(tokens).filter(([n]) => !isBg(n) && !/line|border|divider|shadow|ring|outline/i.test(n));
  for (const [fn, fv] of fgs) {
    const base = onBase(fn);
    const pairs = base ? (tokens[base] ? [[base, tokens[base]]] : []) : bgs;
    for (const [bn, bv] of pairs) {
      const r = ratio(fv, bv);
      contrast.push({ theme, fg: fn, fgHex: fv, bg: bn, bgHex: bv, ratio: +r.toFixed(2), normalText: r >= 4.5, largeText: r >= 3, usedAsText: usedAsText(fn) });
    }
  }
}
for (const c of contrast) {
  if (!c.usedAsText) continue; // decorative/unused tokens are listed in the table only
  const where = c.theme === 'root' ? '' : `[${c.theme}] `;
  if (!c.largeText) add('color-contrast', 'HIGH', `${where}--${c.fg} на --${c.bg}: ${c.ratio}:1 – ниже 3:1, не годится для текста`, CSS);
  else if (!c.normalText) add('color-contrast', 'MEDIUM', `${where}--${c.fg} на --${c.bg}: ${c.ratio}:1 – только крупный текст (≥ 24px или ≥ 18.66px bold), проверить, где используется`, CSS);
}

// ---------- output ----------
const ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const list = [...findings.values()]
  .map((f) => ({ ...f, pages: [...f.pages] }))
  .sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || a.id.localeCompare(b.id));

if (json) {
  console.log(JSON.stringify({ root, pages: htmlFiles.length, findings: list, contrast }, null, 2));
} else {
  console.log(`Web design audit (static): ${htmlFiles.length} HTML pages in ${root}\n`);
  for (const sev of ORDER) {
    const items = list.filter((f) => f.severity === sev);
    console.log(`== ${sev} (${items.length}) ==`);
    for (const f of items) {
      const where = f.pages.length > 3 ? `${f.pages.slice(0, 3).join(', ')} … +${f.pages.length - 3}` : f.pages.join(', ');
      console.log(`- [${f.id}] ${f.message}${f.sample ? ` :: ${f.sample}` : ''}\n    at: ${where}`);
    }
    console.log('');
  }
  if (contrast.length) {
    console.log('== Contrast of color tokens (fg on bg), worst first ==');
    for (const c of contrast.sort((a, b) => a.ratio - b.ratio).slice(0, 40))
      console.log(
        `  ${c.ratio.toFixed(2).padStart(5)}:1  ${c.normalText ? 'AA  ' : c.largeText ? 'large' : 'FAIL '}  ${c.theme === 'root' ? '' : `[${c.theme}] `}--${c.fg} ${c.fgHex} on --${c.bg} ${c.bgHex}${c.usedAsText ? '' : ' (not used as text)'}`,
      );
  }
}
