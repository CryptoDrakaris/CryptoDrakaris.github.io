#!/usr/bin/env node
// Static web design audit over built HTML + CSS. No dependencies, Node 18+.
// Usage: node audit-static.mjs <build-dir|page.html> [--css extra.css ...] [--json] [--no-taste]
// Heuristic parsing (tolerant tag scanner, small CSS block parser): confirm CRITICAL/HIGH findings
// against source before reporting. notApplicable lists rules that had nothing to check (no images,
// no forms, no colour tokens): they are not passes. Exit code: 0 clean, 1 at least one CRITICAL, 2 bad input.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { tasteChecks } from './taste-checks.mjs';
import { srgbToLab, deltaE2000, parseColor } from './color-delta.mjs';
import { loadCanon } from './canon.mjs';

const USAGE = 'Usage: node audit-static.mjs <build-dir|page.html> [--css file.css ...] [--canon tokens.css|tokens.json] [--json] [--no-taste]';
const fail = (msg) => {
  console.error(`Error: ${msg}\n${USAGE}`);
  process.exit(2);
};
const args = process.argv.slice(2);
let json = false, noTaste = false, root = null, canonFile = null;
const extraCss = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--json') json = true;
  else if (a === '--no-taste') noTaste = true;
  else if (a === '--css') {
    if (!args[i + 1] || args[i + 1].startsWith('--')) fail('--css needs a file');
    extraCss.push(args[++i]);
  } else if (a.startsWith('--css=')) extraCss.push(a.slice(6));
  else if (a === '--canon') {
    if (!args[i + 1] || args[i + 1].startsWith('--')) fail('--canon needs a tokens file');
    canonFile = args[++i];
  } else if (a.startsWith('--canon=')) canonFile = a.slice(8);
  else if (a === '--help' || a === '-h') {
    console.log(USAGE);
    process.exit(0);
  } else if (a.startsWith('-')) fail(`unknown option ${a}`);
  else if (root) fail(`one build folder or page at a time (got ${root} and ${a})`);
  else root = a;
}
if (!root) fail('no build folder given');
const rootStat = await stat(root).catch(() => null);
if (!rootStat) fail(`${root} does not exist`);
for (const f of extraCss) if (!(await stat(f).catch(() => null))?.isFile()) fail(`--css file ${f} does not exist`);
if (canonFile && !(await stat(canonFile).catch(() => null))?.isFile()) fail(`--canon file ${canonFile} does not exist`);
if (canonFile && !/\.(css|json)$/i.test(canonFile)) fail(`--canon takes a .css or .json tokens file (got ${canonFile})`);
const single = rootStat.isFile() ? root : null;
if (single && !/\.html?$/i.test(single)) fail(`${root} is not a folder or an .html file`);
const base = single ? path.dirname(single) : root;

// ---------- helpers ----------
async function walk(dir, exts, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, exts, out);
    else if (exts.includes(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

const findings = new Map(); // key -> {id, severity, message, pages:Set, sample}
function add(id, severity, message, page, sample = '') {
  const key = `${id}|${message}|${sample}`;
  if (!findings.has(key)) findings.set(key, { id, severity, message, pages: new Set(), sample });
  findings.get(key).pages.add(page);
}

// Attributes may be quoted, single-quoted or bare (minified HTML); a quoted value may contain ">".
const ATTRS = `((?:[^>"']|"[^"]*"|'[^']*')*)`;
const tags = (src, names) => [...src.matchAll(new RegExp(`<(${names})(?![\\w:-])${ATTRS}>`, 'gi'))];
function parseAttrs(s) {
  const o = {};
  for (const m of s.matchAll(/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const k = m[1].toLowerCase();
    if (!(k in o)) o[k] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return o;
}
const attrsOf = (tag) => parseAttrs(tag.replace(/^<[^\s>\/]+/, '').replace(/\/?>$/, ''));
const attr = (tag, name) => attrsOf(tag)[name] ?? null;
const hasAttr = (tag, name) => name in attrsOf(tag);
const relHas = (tag, token) => (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/).includes(token);
const stripTags = (s) => s.replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/<style[\s\S]*?<\/style\s*>/gi, '').replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').trim();
const short = (s, n = 110) => s.replace(/\s+/g, ' ').slice(0, n);
// markup only: comments, <template> content and script/style text are not part of the page structure
const scrub = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<template\b[\s\S]*?<\/template\s*>/gi, '')
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, '$1$2')
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style\s*>)/gi, '$1$2');
// is position `at` inside an open <name> … </name> of `lower` (lower-cased markup)?
const insideOf = (lower, at, name) => lower.lastIndexOf(`<${name}`, at) > lower.lastIndexOf(`</${name}`, at);

const VAGUE_LINK = /^(здесь|тут|сюда|по ссылке|ссылка|подробнее|читать далее|читать|далее|ещё|еще|узнать больше|осында|толығырақ|here|click here|link|more|read more|learn more|details)[\s.…→»>]*$/i;

// ---------- color ----------
// parseColor (hex, rgb, hsl, oklch, oklab) lives in color-delta.mjs, shared with the canon loader
const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
const lum = ({ r, g, b }) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// ---------- CSS ----------
/** Flat list of style rules {sels, decls:[[prop, value]], media:[at-rule preludes]}; nested CSS (&) is resolved. */
function cssRules(src) {
  const css = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  const splitTop = (s) => {
    const parts = [];
    let depth = 0, cur = '';
    for (const c of s) {
      if (c === '(' || c === '[') depth++;
      if (c === ')' || c === ']') depth--;
      if (c === ',' && depth === 0) (parts.push(cur.trim()), (cur = ''));
      else cur += c;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  };
  const resolve = (head, parent) => {
    const own = splitTop(head);
    if (!parent) return own;
    const p = parent.length === 1 ? parent[0] : `:is(${parent.join(', ')})`;
    return own.map((s) => (s.includes('&') ? s.replace(/&/g, p) : `${p} ${s}`));
  };
  const block = (ctx) => {
    const decls = [];
    let buf = '', depth = 0;
    while (i < css.length) {
      const c = css[i];
      if (c === '"' || c === "'") {
        const j = css.indexOf(c, i + 1);
        const end = j < 0 ? css.length : j + 1;
        buf += css.slice(i, end);
        i = end;
        continue;
      }
      if (c === '(') depth++;
      if (c === ')') depth = Math.max(0, depth - 1);
      if (depth === 0 && c === ';') {
        decls.push(buf);
        buf = '';
        i++;
        continue;
      }
      if (depth === 0 && c === '{') {
        const head = buf.trim();
        buf = '';
        i++;
        if (head.startsWith('@')) {
          const group = /^@(media|supports|layer|container|scope|document)\b/i.test(head);
          const inner = { sels: group ? ctx.sels : null, media: [...ctx.media, head], skip: ctx.skip || !group };
          const d = block(inner);
          if (group && ctx.sels && d.length && !ctx.skip) out.push({ sels: ctx.sels, decls: d, media: inner.media });
        } else {
          const rule = { sels: resolve(head, ctx.sels), decls: [], media: ctx.media };
          if (!ctx.skip) out.push(rule);
          rule.decls = block({ sels: rule.sels, media: ctx.media, skip: ctx.skip });
        }
        continue;
      }
      if (depth === 0 && c === '}') {
        i++;
        if (buf.trim()) decls.push(buf);
        return decls.map(toDecl).filter(Boolean);
      }
      buf += c;
      i++;
    }
    if (buf.trim()) decls.push(buf);
    return decls.map(toDecl).filter(Boolean);
  };
  const toDecl = (s) => {
    const k = s.indexOf(':');
    if (k < 0) return null;
    const prop = s.slice(0, k).trim();
    return prop ? [prop.startsWith('--') ? prop : prop.toLowerCase(), s.slice(k + 1).trim().replace(/\s*!important$/i, '')] : null;
  };
  while (i < css.length) block({ sels: null, media: [], skip: false });
  return out;
}

// ---------- HTML checks ----------
const htmlFiles = single ? [single] : await walk(root, ['.html', '.htm']);
if (!htmlFiles.length) fail(`no .html files in ${root}: build the project first`);
const cssChunks = [];
const htmlTexts = [];
const titles = new Map();
const seen = { img: 0, video: 0, field: 0, control: 0, canvas: 0 };
const missingRequired = [];

for (const file of htmlFiles) {
  const page = '/' + path.relative(base, file).replace(/\\/g, '/').replace(/index\.html?$/, '');
  const raw = await readFile(file, 'utf8');
  htmlTexts.push(raw);
  const noComments = raw.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of noComments.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) cssChunks.push(m[1]);
  const html = scrub(raw);
  const lower = html.toLowerCase();

  const metas = tags(html, 'meta').map((m) => m[0]);
  const links = tags(html, 'link').map((m) => m[0]);
  const metaBy = (key, val) => metas.find((t) => (attr(t, key) ?? '').toLowerCase() === val);
  const isRedirect = !!metaBy('http-equiv', 'refresh');
  // a noindex page (a language picker that redirects by script, a thank-you page) is a service
  // page: no SEO metadata and no skip link are expected, but its content is still checked
  const isService = isRedirect || /noindex/i.test(attr(metaBy('name', 'robots') ?? '', 'content') ?? '');
  const htmlTag = tags(html, 'html')[0]?.[0] ?? '';
  const lang = attr(htmlTag, 'lang');

  // html-lang
  if (!lang) add('html-lang', 'HIGH', '<html> без атрибута lang', page);

  // viewport-meta
  const vp = metaBy('name', 'viewport');
  if (!vp && !isRedirect) add('viewport-meta', 'CRITICAL', 'Нет meta viewport', page);
  else if (vp) {
    const c = attr(vp, 'content') || '';
    if (/user-scalable\s*=\s*(no|0)\b|maximum-scale\s*=\s*(0?\.\d+|1(\.0+)?)(?![\d.])/i.test(c))
      add('viewport-meta', 'CRITICAL', 'Масштабирование отключено в meta viewport', page, c);
  }

  // meta
  const title = stripTags(html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? '');
  if (!title) add('meta-title', 'HIGH', 'Пустой или отсутствующий <title>', page);
  else {
    // duplicates only matter within one language version
    const key = `${(lang ?? '').toLowerCase()}|${title}`;
    if (!isService) titles.set(key, [...(titles.get(key) ?? []), page]);
    if (title.length > 65) add('meta-title', 'LOW', 'Title длиннее 65 символов', page, title);
  }
  if (isRedirect && !/noindex/i.test(attr(metaBy('name', 'robots') ?? '', 'content') ?? '')) add('redirect-pages', 'LOW', 'Страница-редирект без noindex', page);
  if (!isService) {
    if (!metaBy('name', 'description')) add('meta-description', 'MEDIUM', 'Нет meta description', page);
    if (!links.some((t) => relHas(t, 'canonical'))) add('canonical', 'LOW', 'Нет link rel=canonical', page);
    for (const p of ['og:title', 'og:description']) if (!metaBy('property', p)) add('open-graph', 'MEDIUM', `Нет ${p}`, page);
    const og = metaBy('property', 'og:image');
    if (!og) add('open-graph', 'LOW', 'Нет og:image', page);
    else if (!/^https?:\/\//.test(attr(og, 'content') ?? '')) add('open-graph', 'MEDIUM', 'og:image не абсолютный URL', page, attr(og, 'content') ?? '');
    if (!links.some((t) => /icon/i.test(attr(t, 'rel') ?? ''))) add('favicon', 'LOW', 'Нет favicon', page);
    for (const t of links) if (/^kz$/i.test(attr(t, 'hreflang') ?? '')) add('hreflang', 'MEDIUM', 'Код языка kz вместо kk', page);
  }

  if (isRedirect) continue;

  // the document body; without <body> (the tag is optional) everything after </head>
  const bodyAt = html.search(/<body(?![\w-])/i);
  const bodyFrom = bodyAt >= 0 ? bodyAt : Math.max(0, html.search(/<\/head\s*>/i));
  const body = html.slice(bodyFrom);
  const bodyLower = lower.slice(bodyFrom);

  // landmarks & skip link
  if (!tags(body, 'main').length && !tags(body, '[a-z]+').some((m) => (attr(m[0], 'role') ?? '') === 'main')) add('landmarks', 'MEDIUM', 'Нет <main>', page);
  const navs = tags(body, 'nav').map((m) => m[0]);
  if (navs.length > 1 && navs.some((n) => !attr(n, 'aria-label') && !attr(n, 'aria-labelledby'))) add('landmarks', 'LOW', 'Несколько <nav> без aria-label', page);
  const firstLink = tags(body, 'a').find((m) => hasAttr(m[0], 'href'))?.[0] ?? '';
  if (!isService && !(attr(firstLink, 'href') ?? '').startsWith('#')) add('skip-links', 'MEDIUM', 'Первая ссылка на странице не скип-ссылка к контенту', page);

  // headings
  const hs = tags(body, 'h[1-6]').map((m) => +m[1][1]);
  const h1 = hs.filter((l) => l === 1).length;
  if (h1 === 0) add('heading-hierarchy', 'MEDIUM', 'Нет h1', page);
  if (h1 > 1) add('heading-hierarchy', 'MEDIUM', `h1 на странице: ${h1}`, page);
  for (let i = 1; i < hs.length; i++)
    if (hs[i] > hs[i - 1] + 1) {
      add('heading-hierarchy', 'MEDIUM', `Пропуск уровня заголовка h${hs[i - 1]} → h${hs[i]}`, page);
      break;
    }

  // images
  const imgs = tags(body, 'img');
  seen.img += imgs.length;
  for (const m of imgs) {
    const tag = m[0];
    const src = attr(tag, 'src') ?? '';
    const sample = src.split('/').slice(-2).join('/');
    if (!hasAttr(tag, 'alt')) add('alt-text', 'CRITICAL', '<img> без атрибута alt', page, sample);
    if (!attr(tag, 'width') || !attr(tag, 'height')) add('image-dimension', 'HIGH', '<img> без width/height (риск CLS)', page, sample);
    // inside <picture> the browser picks a <source> (AVIF/WebP); the <img> src is the fallback
    if (/\.(png|jpe?g|gif)(\?|#|$)/i.test(src) && !insideOf(bodyLower, m.index, 'picture')) add('image-optimization', 'MEDIUM', 'Растровое изображение не в WebP/AVIF', page, sample);
  }
  const firstImg = imgs[0]?.[0];
  if (firstImg && (attr(firstImg, 'loading') ?? '').toLowerCase() === 'lazy') add('lazy-load-below-fold', 'LOW', 'Первая картинка страницы с loading="lazy": проверить в браузере, в первом ли она экране (отчёт images из browser-checks.js); если да, LCP задерживается', page, (attr(firstImg, 'src') ?? '').split('/').pop());

  // video: poster and size against layout shift, autoplay only muted and inline
  seen.video += tags(body, 'video').length;
  for (const m of tags(body, 'video')) {
    const tag = m[0];
    const src = (attr(tag, 'src') ?? '').split('/').pop();
    if (!hasAttr(tag, 'poster') || !attr(tag, 'width') || !attr(tag, 'height')) add('video-poster', 'MEDIUM', '<video> без poster или width/height', page, src);
    if (hasAttr(tag, 'autoplay') && !hasAttr(tag, 'muted')) add('media-autoplay-controls', 'HIGH', '<video autoplay> без muted: звук включится сам', page, src);
    if (hasAttr(tag, 'autoplay') && !hasAttr(tag, 'playsinline')) add('video-poster', 'MEDIUM', '<video autoplay> без playsinline: iPhone откроет на весь экран', page, src);
  }

  // interactive names
  for (const m of body.matchAll(new RegExp(`<(a|button)(?![\\w:-])${ATTRS}>([\\s\\S]*?)<\\/\\1\\s*>`, 'gi'))) {
    const [whole, tagName, attrs, inner] = m;
    seen.control++;
    const open = `<${tagName}${attrs}>`;
    if (tagName.toLowerCase() === 'a' && attr(open, 'aria-hidden') === 'true') continue;
    const text = stripTags(inner);
    const imgAlt = tags(inner, 'img').some((i) => (attr(i[0], 'alt') ?? '').trim());
    const svgName = tags(inner, 'svg').some((s) => (attr(s[0], 'aria-label') ?? '').trim() || attr(s[0], 'aria-labelledby')) || /<title\b[^>]*>\s*\S/i.test(inner);
    const named = text || imgAlt || svgName || attr(open, 'aria-label') || attr(open, 'aria-labelledby') || attr(open, 'title') || /class\s*=\s*["']?[^"'>]*(sr-only|visually-hidden)/i.test(inner);
    if (!named) add('aria-labels', 'CRITICAL', `<${tagName.toLowerCase()}> без доступного имени`, page, short(whole));
    // link-purpose (WCAG 2.4.4): "здесь", "подробнее" mean nothing out of context (screen reader link lists)
    if (tagName.toLowerCase() === 'a' && VAGUE_LINK.test(text) && !attr(open, 'aria-label') && !attr(open, 'aria-labelledby') && !attr(open, 'aria-describedby'))
      add('link-purpose', 'MEDIUM', 'Текст ссылки не говорит, куда она ведёт', page, text);
    if (tagName.toLowerCase() === 'a') {
      if (attr(open, 'target') === '_blank' && !/noopener|noreferrer/.test(attr(open, 'rel') ?? '')) add('external-links', 'LOW', 'target=_blank без rel=noopener', page, attr(open, 'href') ?? '');
      if (!hasAttr(open, 'href')) add('semantic-controls', 'MEDIUM', '<a> без href (использовать <button>)', page, short(whole));
    }
  }
  for (const m of tags(body, 'div|span|li|img')) if (hasAttr(m[0], 'onclick')) add('semantic-controls', 'HIGH', `onclick на <${m[1].toLowerCase()}> вместо <button>/<a>`, page);
  // canvas-name: a canvas is a picture for screen readers only with a name or fallback content
  for (const m of body.matchAll(new RegExp(`<canvas(?![\\w:-])${ATTRS}>([\\s\\S]*?)<\\/canvas\\s*>`, 'gi'))) {
    seen.canvas++;
    const open = `<canvas${m[1]}>`;
    if (attr(open, 'aria-hidden') !== 'true' && !attr(open, 'aria-label') && !attr(open, 'aria-labelledby') && !stripTags(m[2]) && !/<(img|a|button)\b/i.test(m[2]))
      add('canvas-name', 'HIGH', '<canvas> без имени и без запасного содержимого: скринридер его пропустит (декоративный – aria-hidden="true")', page, short(open, 80));
  }
  for (const m of tags(body, 'svg')) {
    const tag = m[0];
    const titled = !tag.endsWith('/>') && /^\s*(<desc\b[^>]*>[\s\S]*?<\/desc>\s*)?<title\b/i.test(body.slice(m.index + tag.length));
    if (attr(tag, 'aria-hidden') !== 'true' && !attr(tag, 'role') && !attr(tag, 'aria-label') && !attr(tag, 'aria-labelledby') && !titled)
      add('icon-context', 'LOW', '<svg> без aria-hidden или role="img" с именем', page);
  }

  // forms
  const labels = tags(body, 'label').map((m) => ({ tag: m[0], at: m.index, text: stripTags(body.slice(m.index, bodyLower.indexOf('</label', m.index) >>> 0)) }));
  const labelFor = new Map(labels.filter((l) => attr(l.tag, 'for')).map((l) => [attr(l.tag, 'for'), l.text]));
  for (const m of tags(body, 'input|select|textarea')) {
    const tag = m[0];
    const type = (attr(tag, 'type') ?? '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
    seen.field++;
    const wrapping = insideOf(bodyLower, m.index, 'label') ? labels.filter((l) => l.at < m.index).pop() : null;
    const id = attr(tag, 'id');
    const labelText = wrapping?.text ?? (id && labelFor.has(id) ? labelFor.get(id) : null);
    if (labelText === null && !attr(tag, 'aria-label') && !attr(tag, 'aria-labelledby')) add('input-labels', 'CRITICAL', `<${m[1].toLowerCase()}> без подписи`, page, short(tag));
    if (labelText && /\*/.test(labelText) && !hasAttr(tag, 'required') && attr(tag, 'aria-required') !== 'true') missingRequired.push(page);
    if (m[1].toLowerCase() === 'input' && /^(email|phone|tel|name|fname|lname|username)$/i.test(attr(tag, 'name') ?? '') && !attr(tag, 'autocomplete'))
      add('input-type-keyboard', 'MEDIUM', 'Поле без autocomplete', page, attr(tag, 'name'));
  }

  // duplicate ids (label for, aria-labelledby and anchors pick the first one)
  const ids = tags(body, '[a-z][\\w:-]*').map((m) => attr(m[0], 'id')).filter(Boolean);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  for (const d of new Set(dup)) add('duplicate-ids', 'MEDIUM', 'Повторяющийся id', page, d);

  // scripts
  for (const m of tags(html, 'script')) {
    const src = attr(m[0], 'src') ?? '';
    if (/^https?:/.test(src) && !hasAttr(m[0], 'async') && !hasAttr(m[0], 'defer') && attr(m[0], 'type') !== 'module') add('third-party-scripts', 'MEDIUM', 'Внешний скрипт без async/defer', page, src);
  }

  // fonts
  const gfonts = links.filter((t) => /^https:\/\/fonts\.googleapis\.com/.test(attr(t, 'href') ?? ''));
  for (const t of gfonts) if (!/display=(swap|optional|fallback)/.test(attr(t, 'href'))) add('font-loading', 'MEDIUM', 'Google Fonts без display=swap', page);
  if (gfonts.length && !links.some((t) => relHas(t, 'preconnect') && /fonts\.gstatic\.com/.test(attr(t, 'href') ?? ''))) add('font-loading', 'LOW', 'Нет preconnect к fonts.gstatic.com', page);

  // taste heuristics (never above MEDIUM)
  if (!noTaste) tasteChecks(raw, page, add);
}

for (const [k, pages] of titles) if (pages.length > 1) for (const p of pages) add('meta-title', 'MEDIUM', 'Title повторяется на нескольких страницах одного языка', p, k.split('|').slice(1).join('|'));
for (const p of missingRequired) add('required-indicators', 'MEDIUM', 'Подпись со звёздочкой, но у поля нет required', p);
if (!single) {
  const present = new Set((await readdir(root)).map((n) => n.toLowerCase()));
  for (const f of ['sitemap.xml', 'robots.txt'])
    if (!present.has(f) && !(f === 'sitemap.xml' && [...present].some((n) => /^sitemap.*\.xml$/.test(n)))) add('sitemap-robots', 'LOW', `Нет ${f} в корне сборки`, '/');
}

// ---------- CSS checks ----------
for (const f of single ? [] : await walk(root, ['.css'])) cssChunks.push(await readFile(f, 'utf8'));
for (const f of extraCss) cssChunks.push(await readFile(f, 'utf8'));
const css = cssChunks.join('\n');
const rules = cssRules(css);
const CSS = 'CSS';
const declsOf = (r, ...props) => r.decls.filter(([p]) => props.includes(p)).map(([, v]) => v);

// reduced-motion: either the reduce query switches motion off or no-preference switches it on
const moving = rules.some((r) => declsOf(r, 'transition', 'animation', 'animation-name').some((v) => !/^(none|0s?)$/i.test(v)));
if (moving && !/prefers-reduced-motion\s*:\s*(reduce|no-preference)/i.test(css))
  add('reduced-motion', 'HIGH', 'Есть transition/animation, но нет @media (prefers-reduced-motion: reduce)', CSS);

// focus-states: each outline-removing selector needs its own :focus-visible replacement
const baseOf = (s) => s.replace(/:focus(-visible|-within)?(?![\w-])/g, '').replace(/\s+/g, ' ').trim();
const killsOutline = (r) => declsOf(r, 'outline').some((v) => /^(none|0(px)?)(\s|$)/i.test(v)) || declsOf(r, 'outline-style').includes('none') || declsOf(r, 'outline-width').some((v) => /^0(px)?$/.test(v));
const restorers = rules
  .filter((r) => !killsOutline(r) && (declsOf(r, 'outline', 'outline-style', 'outline-color', 'outline-width').length || declsOf(r, 'box-shadow', 'border', 'border-color', 'background', 'background-color', 'text-decoration').some((v) => v !== 'none')))
  .flatMap((r) => r.sels.filter((s) => /:focus(-visible)?(?![\w-])/.test(s) && !/:not\(:focus-visible\)/.test(s)).map(baseOf));
const lastCompound = (s) => s.split(/[\s>+~]+/).pop();
const tagOf = (s) => lastCompound(s).match(/^[a-z][\w-]*/i)?.[0]?.toLowerCase();
for (const r of rules.filter(killsOutline))
  for (const sel of r.sels) {
    if (/:not\(:focus-visible\)/.test(sel)) continue; // the :focus:not(:focus-visible) pattern keeps the keyboard ring
    const b = baseOf(sel);
    const global = (x) => x === '' || x === '*' || x === ':root *';
    const ok = restorers.some((x) => x === b || global(x) || (tagOf(b) && x === tagOf(b))) || (global(b) && restorers.length);
    if (!ok) add('focus-states', 'HIGH', 'outline: none без замены через :focus-visible', CSS, short(sel, 80));
  }
if (!/:focus-visible|:focus(?![\w-])/.test(css)) add('focus-states', 'MEDIUM', 'В CSS нет стилей :focus-visible / :focus (проверить дефолтный фокус)', CSS);

// readable-font-size: font-size, the font shorthand and the minimum of clamp()
for (const r of rules)
  for (const [p, v] of r.decls) {
    if (p !== 'font-size' && p !== 'font') continue;
    const val = v.match(/^clamp\(\s*([^,]+),/i)?.[1] ?? v;
    const m = p === 'font' ? val.match(/(?:^|\s)(\d*\.?\d+)(px|rem)(?=\s|\/|$)/) : val.match(/^(\d*\.?\d+)(px|rem)$/);
    if (!m) continue;
    const px = m[2] === 'rem' ? +m[1] * 16 : +m[1];
    if (px < 12) add('readable-font-size', 'MEDIUM', `${p} ${m[1]}${m[2]}${m[2] === 'rem' ? ` ≈ ${px.toFixed(1)}px` : ''} < 12px`, CSS, short(r.sels.join(', '), 60));
  }
const LAYOUT_PROPS = /^(width|height|top|left|right|bottom|inset(-[a-z-]+)?|(min|max)-(width|height)|margin(-[a-z-]+)?|padding(-[a-z-]+)?)$/;
for (const r of rules)
  for (const v of declsOf(r, 'transition', 'transition-property'))
    for (const part of v.split(/,(?![^(]*\))/)) {
      const prop = part.trim().split(/\s+/)[0].toLowerCase();
      if (LAYOUT_PROPS.test(prop)) add('transform-performance', 'MEDIUM', `transition по свойству ${prop}`, CSS);
    }
for (const r of rules) for (const v of declsOf(r, 'z-index')) if (+v >= 1000) add('z-index-management', 'LOW', `z-index: ${v}`, CSS);
if (rules.some((r) => r.decls.some(([, v]) => /(^|[^-\w.])100vh/.test(v)))) add('viewport-units', 'LOW', '100vh (на мобильном лучше svh/dvh)', CSS);
// raw colours in declaration values (selectors such as #bad are ids, not colours)
let rawHex = 0, tokenDefs = 0;
for (const r of rules)
  for (const [p, v] of r.decls) {
    const n = (v.match(/#[0-9a-f]{3,8}\b/gi) ?? []).length;
    if (p.startsWith('--')) tokenDefs += n ? 1 : 0;
    else rawHex += n;
  }
if (rawHex > Math.max(12, tokenDefs * 1.5)) add('color-semantic', 'LOW', `Много сырых hex вне токенов: ${rawHex} (токенов: ${tokenDefs})`, CSS);

// ---------- contrast matrix ----------
// Token sets per theme: :root/:host/html, [data-theme=x], .dark, @media (prefers-color-scheme: dark).
// Pairs come from real usage: color and background of one rule; a colour without its own
// background is read against the page background (html/body/:root) of the same theme.
const themeOf = (sel, media) => {
  const dark = media.some((m) => /prefers-color-scheme\s*:\s*dark/i.test(m));
  const s = sel.trim();
  if (/^(:root|:host|html|body)$/i.test(s)) return dark ? 'dark' : 'root';
  const m = s.match(/^(?::root|html|body|:host)?\s*\[data-(?:theme|mode|color-scheme|bs-theme)\s*=\s*['"]?([\w-]+)['"]?\]$/i) ?? s.match(/^(?::root|html|body)?\.([\w-]+)$/i) ?? s.match(/^:host\(\.([\w-]+)\)$/i);
  return m ? m[1].toLowerCase() : null;
};
const themes = new Map([['root', {}]]);
for (const r of rules)
  for (const sel of r.sels) {
    const t = themeOf(sel, r.media);
    if (!t) continue;
    const set = themes.get(t) ?? {};
    for (const [p, v] of r.decls) if (p.startsWith('--')) set[p.slice(2)] = v; // later rules win, as in the cascade
    themes.set(t, set);
  }
const resolveVars = (v, tokens, depth = 0) =>
  depth > 8 ? v : v.replace(/var\(\s*--([\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, n, fb) => (tokens[n] !== undefined ? resolveVars(tokens[n], tokens, depth + 1) : fb !== undefined ? resolveVars(fb.trim(), tokens, depth + 1) : `var(--${n})`));
const bgValue = (r) => {
  const v = declsOf(r, 'background-color')[0] ?? declsOf(r, 'background')[0];
  return v && !/gradient|url\(/i.test(v) ? v : null;
};
const pageRules = rules.filter((r) => r.sels.some((s) => /^(:root|html|body)$/i.test(s.trim())) && bgValue(r));
const usages = rules.filter((r) => declsOf(r, 'color').some((v) => v.includes('var(')));
// "On-color" tokens (--gold-ink, --primary-foreground, --on-primary) are text placed ON their base color.
const onBase = (n) => n.match(/^(.+)-(ink|fg|foreground|contrast)$/)?.[1] ?? n.match(/^on-(.+)$/)?.[1] ?? null;
const tokenName = (v) => v.match(/var\(\s*--([\w-]+)/)?.[1];
const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const contrast = [];
const unresolved = new Set();
const seenPairs = new Set();
const rootTokens = themes.get('root');
for (const [theme, own] of themes) {
  const tokens = theme === 'root' ? own : { ...rootTokens, ...own };
  const page = (() => {
    for (const r of [...pageRules].reverse()) {
      const c = parseColor(resolveVars(bgValue(r), tokens));
      if (c) return c.a < 1 ? over(c, WHITE) : c;
    }
    return null;
  })();
  const pageBg = page ?? WHITE;
  const record = (fgName, fgExpr, bgName, bgExpr, used) => {
    const fg = parseColor(resolveVars(fgExpr, tokens));
    const bgRaw = bgExpr ? parseColor(resolveVars(bgExpr, tokens)) : pageBg;
    if (!fg || !bgRaw) {
      if (used) unresolved.add(`--${fgName ?? '?'}${!fg ? ` = ${resolveVars(fgExpr, tokens)}` : ` на ${resolveVars(bgExpr, tokens)}`}`);
      return;
    }
    const bg = bgRaw.a < 1 ? over(bgRaw, pageBg) : bgRaw;
    const fgOn = fg.a < 1 ? over(fg, bg) : fg;
    const key = `${fgName}|${bgName}|${hex(fgOn)}|${hex(bg)}`;
    if (seenPairs.has(key)) return; // a theme that does not change the pair repeats the root result
    seenPairs.add(key);
    const r = ratio(fgOn, bg);
    contrast.push({ theme, fg: fgName, fgHex: hex(fgOn), bg: bgName, bgHex: hex(bg), ratio: +r.toFixed(2), normalText: r >= 4.5, largeText: r >= 3, usedAsText: used });
  };
  for (const r of usages) {
    const fgExpr = declsOf(r, 'color').find((v) => v.includes('var('));
    const bgExpr = bgValue(r);
    const bgName = bgExpr ? (tokenName(bgExpr) ? `--${tokenName(bgExpr)}` : bgExpr) : page ? 'фоне страницы' : 'белом фоне по умолчанию';
    record(tokenName(fgExpr) ?? fgExpr, fgExpr, bgName, bgExpr, true);
  }
  // on-colour tokens are listed with their base even where no rule pairs them
  for (const n of Object.keys(tokens)) {
    const b = onBase(n);
    if (b && tokens[b] !== undefined && !/line|border|divider|shadow|ring|outline/i.test(n)) record(n, `var(--${n})`, `--${b}`, `var(--${b})`, usages.some((r) => declsOf(r, 'color').some((v) => tokenName(v) === n)));
  }
}
for (const c of contrast) {
  if (!c.usedAsText) continue; // pairs nobody uses as text are listed in the table only
  const where = c.theme === 'root' ? '' : `[${c.theme}] `;
  if (!c.largeText) add('color-contrast', 'HIGH', `${where}--${c.fg} на ${c.bg}: ${c.ratio}:1 – ниже 3:1, не годится для текста`, CSS);
  else if (!c.normalText) add('color-contrast', 'MEDIUM', `${where}--${c.fg} на ${c.bg}: ${c.ratio}:1 – только крупный текст (≥ 24px или ≥ 18.66px bold), проверить, где используется`, CSS);
  if (c.theme !== 'root' && c.bgHex === '#000000' && c.fgHex === '#ffffff') add('color-dark-mode', 'MEDIUM', `[${c.theme}] чистый белый текст на чистом чёрном фоне: в тёмной теме рябит, приглушить оба`, CSS);
}
if (unresolved.size) add('color-contrast', 'LOW', `Контраст не посчитан для ${unresolved.size} цвет(ов) текста: значение не разобрано (color-mix, lab, внешний токен) – проверить в браузере`, CSS, short([...unresolved].join('; '), 160));
if (!contrast.length && /--[\w-]+\s*:/.test(css) && usages.length) add('color-contrast', 'LOW', 'Матрица контраста пуста: токены есть, но пары цвет/фон не собраны – проверить контраст в браузере (browser-checks.js)', CSS);

// ---------- palette and canon (ΔE2000 in CIE Lab, scripts/color-delta.mjs) ----------
// palette-near-duplicates: two tokens (or two raw values) closer than ΔE 3 are one colour.
// canon-drift: raw colours away from the canon – the --canon file, else the site's own colour
// tokens; pure black and white are left out (outlines, overlays). canon-coverage: tokens that
// nothing references (var() in CSS and HTML, any mention in the JS bundle).
const jsTexts = [];
for (const f of single ? [] : await walk(root, ['.js', '.mjs'])) jsTexts.push(await readFile(f, 'utf8'));
const COLOR_RE = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\([^()]*\)/gi;
const solid = (v) => {
  const c = parseColor(v);
  return c && c.a > 0 ? (c.a < 1 ? over(c, WHITE) : c) : null;
};
const palette = new Map(); // hex -> {hex, lab, names, raw}
const note = (c, name, theme) => {
  const h = hex(c);
  const e = palette.get(h) ?? { hex: h, lab: srgbToLab(c), names: new Set(), themes: new Set(), raw: 0 };
  if (name) (e.names.add(name), e.themes.add(theme));
  else e.raw++;
  palette.set(h, e);
};
const defined = new Set();
for (const r of rules)
  for (const [p, v] of r.decls) {
    if (p.startsWith('--')) {
      defined.add(p.slice(2));
      // a theme's tokens are compared with each other, not with another theme's
      const theme = r.sels.map((s) => themeOf(s, r.media)).find(Boolean) ?? 'root';
      const c = parseColor(resolveVars(v, theme === 'root' ? rootTokens : { ...rootTokens, ...themes.get(theme) }));
      if (c && c.a === 1) note(c, p, theme);
    } else for (const m of v.match(COLOR_RE) ?? []) {
      const c = parseColor(m);
      if (c && c.a === 1) note(c, null);
    }
  }
const colorsAll = [...palette.values()];
const lbl = (e) => (e.names.size ? `${[...e.names][0]} ${e.hex}` : e.hex);
const nearPairs = [];
for (let i = 0; i < colorsAll.length; i++)
  for (let j = i + 1; j < colorsAll.length; j++) {
    const [a, b] = [colorsAll[i], colorsAll[j]];
    if (!!a.names.size !== !!b.names.size) continue; // raw next to a token is canon-drift
    if (a.names.size && ![...a.themes].some((t) => b.themes.has(t))) continue;
    const d = deltaE2000(a.lab, b.lab);
    if (d < 3) nearPairs.push(`${lbl(a)} ≈ ${lbl(b)} (ΔE ${d.toFixed(2)})`);
  }
if (nearPairs.length) add('palette-near-duplicates', 'LOW', `Почти одинаковые цвета (ΔE2000 < 3) – один токен: ${nearPairs.length} пар(ы)`, CSS, short(nearPairs.slice(0, 8).join('; '), 400));

// the canon: a tokens file (.css custom properties or .json design tokens) or the site tokens
let canon = colorsAll.filter((e) => e.names.size).map((e) => ({ name: [...e.names][0], hex: e.hex, lab: e.lab }));
if (canonFile) {
  try {
    canon = (await loadCanon(canonFile)).map((t) => ({ name: t.name, hex: t.hex, lab: srgbToLab(t.rgb) }));
  } catch (e) {
    fail(`--canon ${canonFile}: ${e.message}`);
  }
}
if (canon.length >= 2) {
  const nearest = (lab) => canon.map((t) => ({ t, d: deltaE2000(lab, t.lab) })).sort((a, b) => a.d - b.d)[0];
  const almost = [], off = [];
  for (const e of colorsAll) {
    if (!(e.raw || (canonFile && e.names.size)) || e.hex === '#000000' || e.hex === '#ffffff') continue;
    const n = nearest(e.lab);
    if (n.t.hex === e.hex) continue; // the canon value itself: color-semantic speaks about raw values
    const line = `${lbl(e)}${e.raw > 1 ? ` ×${e.raw}` : ''} → ${n.t.name} ${n.t.hex} (ΔE ${n.d.toFixed(1)})`;
    (n.d <= 5 ? almost : off).push({ line, d: n.d });
  }
  const top = (list) => short(list.sort((a, b) => b.d - a.d).slice(0, 8).map((x) => x.line).join('; '), 400);
  if (off.length) add('canon-drift', canonFile ? 'MEDIUM' : 'LOW', `Цвета вне канона ${canonFile ? `(${path.basename(canonFile)})` : '(токены сайта)'}: ${off.length}, дальше ΔE 5 от ближайшего токена; ΔE > 20 – чужой цвет`, CSS, top(off));
  if (almost.length) add('canon-drift', 'LOW', `Сырые цвета почти равны токену (ΔE ≤ 5): ${almost.length} – заменить на var() токена`, CSS, top(almost));
}
// GSAP in the shipped bundle: debug markers and scrub mixed with toggleActions (gsap-* in web.md)
for (const t of jsTexts) {
  if (!/ScrollTrigger/.test(t)) continue;
  const mk = t.match(/[{,]\s*markers\s*:\s*(?:!0|true|\{)/);
  if (mk) add('gsap-st-markers', 'LOW', 'markers ScrollTrigger в собранном бандле: отладочные метки уедут в продакшен', 'JS', short(t.slice(Math.max(0, mk.index - 40), mk.index + 40)));
  const mix = t.match(/\{[^{}]*\bscrub\s*:[^{}]*\btoggleActions\s*:[^{}]*\}|\{[^{}]*\btoggleActions\s*:[^{}]*\bscrub\s*:[^{}]*\}/);
  if (mix) add('gsap-st-misuse', 'MEDIUM', 'scrub и toggleActions в одном ScrollTrigger: toggleActions не работает', 'JS', short(mix[0], 120));
}

// canon-coverage
const referenced = new Set();
for (const t of [css, ...htmlTexts]) for (const m of t.matchAll(/var\(\s*--([\w-]+)/g)) referenced.add(m[1]);
for (const t of jsTexts) for (const m of t.matchAll(/--([A-Za-z][\w-]*)/g)) referenced.add(m[1]);
const dead = [...defined].filter((n) => !referenced.has(n));
if (dead.length) add('canon-coverage', 'LOW', `Токены без ссылок: ${dead.length} из ${defined.size}${dead.length > 30 ? ' (много – возможно, подключена библиотека токенов целиком)' : ''}`, CSS, short(dead.slice(0, 15).map((n) => `--${n}`).join(', '), 300));
if (canonFile) {
  const unused = canon.filter((t) => !colorsAll.some((e) => deltaE2000(e.lab, t.lab) < 1) && !referenced.has(t.name.replace(/^--/, '')));
  if (unused.length) add('canon-coverage', 'LOW', `Цвета канона не встречаются в CSS сайта: ${unused.length} из ${canon.length}`, CSS, short(unused.slice(0, 15).map((t) => `${t.name} ${t.hex}`).join(', '), 300));
}

// ---------- not applicable: nothing to check is not a pass ----------
const notApplicable = [];
const na = (ids, reason) => notApplicable.push({ ids, reason });
if (!seen.img) na(['alt-text', 'image-dimension', 'image-optimization', 'lazy-load-below-fold'], 'нет <img>');
if (!seen.video) na(['video-poster', 'media-autoplay-controls'], 'нет <video>');
if (!seen.canvas) na(['canvas-name'], 'нет <canvas>');
if (!jsTexts.some((t) => /ScrollTrigger/.test(t))) na(['gsap-st-markers', 'gsap-st-misuse'], single ? 'одна страница: бандл JS не читался' : 'в JS сборки нет ScrollTrigger');
if (!seen.field) na(['input-labels', 'input-type-keyboard', 'required-indicators'], 'нет полей ввода');
if (!seen.control) na(['aria-labels', 'link-purpose', 'external-links'], 'нет ссылок и кнопок');
if (!rules.length) na(['focus-states', 'reduced-motion', 'readable-font-size', 'transform-performance', 'color-contrast'], 'нет CSS: стили не найдены (внешний CSS – через --css)');
else {
  if (!moving) na(['reduced-motion', 'transform-performance'], 'в CSS нет transition и animation');
  if (!contrast.length && ![...findings.values()].some((f) => f.id === 'color-contrast')) na(['color-contrast'], 'матрица контраста пуста: нет пар цвет/фон на токенах – контраст только в браузере');
  if (canon.length < 2) na(['canon-drift'], 'меньше двух цветовых токенов: не с чем сверять');
  if (!defined.size) na(['canon-coverage'], 'нет custom properties');
}
if (single) na(['sitemap-robots'], 'проверялась одна страница, а не папка сборки');
else if (htmlFiles.length < 2) na(['meta-title'], 'одна страница: дубли title не с чем сравнить');

// ---------- output ----------
const ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const list = [...findings.values()]
  .map((f) => ({ ...f, pages: [...f.pages] }))
  .sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity) || a.id.localeCompare(b.id));

if (json) {
  console.log(JSON.stringify({ root, pages: htmlFiles.length, findings: list, notApplicable, contrast }, null, 2));
} else {
  console.log(`Web design audit (static): ${htmlFiles.length} HTML page(s) in ${root}\n`);
  for (const sev of ORDER) {
    const items = list.filter((f) => f.severity === sev);
    console.log(`== ${sev} (${items.length}) ==`);
    for (const f of items) {
      const where = f.pages.length > 3 ? `${f.pages.slice(0, 3).join(', ')} … +${f.pages.length - 3}` : f.pages.join(', ');
      console.log(`- [${f.id}] ${f.message}${f.sample ? ` :: ${f.sample}` : ''}\n    at: ${where}`);
    }
    console.log('');
  }
  if (notApplicable.length) {
    console.log('== N/A: nothing to check – not a pass ==');
    for (const n of notApplicable) console.log(`- ${n.ids.join(', ')}: ${n.reason}`);
    console.log('');
  }
  if (contrast.length) {
    console.log('== Contrast of colour pairs from CSS (text on background), worst first ==');
    const shown = contrast.sort((a, b) => a.ratio - b.ratio).slice(0, 40);
    for (const c of shown)
      console.log(`  ${c.ratio.toFixed(2).padStart(5)}:1  ${c.normalText ? 'AA  ' : c.largeText ? 'large' : 'FAIL '}  ${c.theme === 'root' ? '' : `[${c.theme}] `}--${c.fg} ${c.fgHex} on ${c.bg} ${c.bgHex}${c.usedAsText ? '' : ' (not used as text)'}`);
    if (contrast.length > shown.length) console.log(`  … ${shown.length} of ${contrast.length} pairs shown, all of them in --json`);
  }
}
process.exit(list.some((f) => f.severity === 'CRITICAL') ? 1 : 0);
