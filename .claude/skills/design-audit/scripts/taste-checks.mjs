// "Шаблонность и вкус" (references/taste.md): mechanical checks over built HTML.
// Adapted from taste-skill (MIT, (c) 2026 Leonxlnx). Heuristics, never above MEDIUM.
// Guards from references/taste.md apply: brand canon, language typography and the project stack win.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const SKIP_CONTENT = new Set(['script', 'style', 'svg', 'noscript', 'template']);

// Elements closed implicitly by the next sibling (HTML optional end tags).
const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
const IMPLIED = { li: ['li'], dt: ['dt', 'dd'], dd: ['dt', 'dd'], tr: ['tr', 'td', 'th'], td: ['td', 'th'], th: ['td', 'th'], option: ['option'] };
const SCOPE = { li: ['ul', 'ol', 'menu'], dt: ['dl'], dd: ['dl'], tr: ['table', 'tbody', 'thead', 'tfoot'], td: ['tr'], th: ['tr'], option: ['select', 'datalist', 'optgroup'] };
const ATTRS = `((?:[^>"']|"[^"]*"|'[^']*')*?)`;

/** Minimal tolerant DOM: enough for sibling/child/heading structure of generator output. */
function parse(html) {
  const root = { tag: '#root', cls: '', attrs: '', children: [], parent: null, text: '' };
  let cur = root;
  // a self-closing <svg/> is a leaf, not the start of a skipped block
  const re = new RegExp(`<!--[\\s\\S]*?-->|<(script|style|svg|noscript|template)\\b${ATTRS}(?<!\\/)>[\\s\\S]*?<\\/\\1\\s*>|<\\/([a-zA-Z][\\w-]*)\\s*>|<([a-zA-Z][\\w-]*)${ATTRS}(\\/?)>|([^<]+)`, 'g');
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {
      // skipped-content element kept as a leaf so structure stays right
      cur.children.push({ tag: m[1].toLowerCase(), cls: attr(m[2], 'class'), attrs: m[2], children: [], parent: cur, text: '' });
      continue;
    }
    if (m[3]) {
      const tag = m[3].toLowerCase();
      let n = cur;
      while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) cur = n.parent;
      continue;
    }
    if (m[4]) {
      const tag = m[4].toLowerCase();
      // optional end tags: a new <li> closes the open <li>, a block closes an open <p>
      if (IMPLIED[tag]) {
        for (let n = cur; n && n !== root && !SCOPE[tag].includes(n.tag); n = n.parent)
          if (IMPLIED[tag].includes(n.tag)) {
            cur = n.parent;
            break;
          }
      }
      if (BLOCK.has(tag) && cur.tag === 'p') cur = cur.parent;
      const node = { tag, cls: attr(m[5], 'class'), attrs: m[5], children: [], parent: cur, text: '' };
      cur.children.push(node);
      if (!VOID.has(tag) && !m[6] && !SKIP_CONTENT.has(tag)) cur = node;
      continue;
    }
    if (m[7] && m[7].trim()) cur.children.push({ tag: '#text', text: decode(m[7]), children: [], parent: cur, cls: '' });
  }
  return root;
}

// quoted or bare attribute values (minified HTML drops the quotes)
function attr(s, name) {
  const m = (s || '').match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
}
const decode = (t) => t.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const elements = (n) => n.children.filter((c) => c.tag !== '#text');
const textOf = (n) => (n.tag === '#text' ? n.text : n.children.map(textOf).join(' ')).replace(/\s+/g, ' ').trim();
function* walk(n) {
  yield n;
  for (const c of n.children) yield* walk(c);
}
const find = (n, pred) => {
  for (const x of walk(n)) if (x !== n && pred(x)) return x;
  return null;
};
const all = (n, pred) => [...walk(n)].filter((x) => x !== n && pred(x));
const prevElement = (n) => {
  const sibs = elements(n.parent);
  const i = sibs.indexOf(n);
  return i > 0 ? sibs[i - 1] : null;
};
const short = (s, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const EYEBROW_CLASS = /(^|\s)(eyebrow|kicker|overline|pretitle|pre-title|supertitle)(\s|$)/i;
const CARDISH = /card|feature|benefit|why|pillar|perk|advantage|service/i;
const REPEATED_BLOCK = /card|nft|post|tile|item|group|product|collection|member|entry/i;

const CLICHE_EN = /\b(elevate[sd]?|seamless(ly)?|unleash(es|ed)?|next-gen|game[- ]changer|delve[sd]?|tapestry|revolutioni[sz]e[sd]?|in the world of)\b/i;
const CLICHE_RU = /(погрузитесь в мир|откройте для себя|бесшовн\p{L}*|инновационн\p{L}*|уникальный опыт|на новый уровень|новый уровень)/iu;
const PLACEHOLDER = /(lorem ipsum|john doe|jane doe|acme corp|иван иванов|компания n\b)/i;

/**
 * @param {string} html   built page
 * @param {string} page   page path for reporting
 * @param {(id:string, sev:string, msg:string, page:string, sample?:string)=>void} add
 */
export function tasteChecks(html, page, add) {
  const doc = parse(html);
  const lang = attr(find(doc, (n) => n.tag === 'html')?.attrs, 'lang').toLowerCase().split('-')[0];
  const main = find(doc, (n) => n.tag === 'main') ?? find(doc, (n) => n.tag === 'body') ?? doc;

  // taste-eyebrow-overuse: small labels above headings, max 1 per 3 sections
  // headings inside repeated items (a list of post cards) carry item metadata, not section eyebrows
  const inRepeatedItem = (h) => {
    for (let n = h.parent, depth = 0; n && n.parent && depth < 4; n = n.parent, depth++) {
      const sig = n.tag + '.' + n.cls;
      if (elements(n.parent).filter((x) => x.tag + '.' + x.cls === sig).length >= 2 && ['li', 'a', 'article'].includes(n.tag)) return true;
    }
    return false;
  };
  const headings = all(main, (n) => (n.tag === 'h1' || n.tag === 'h2') && !inRepeatedItem(n));
  const withEyebrow = headings.filter((h) => {
    const prev = prevElement(h);
    // a <time> above a heading is item metadata (a post date), not a section label
    return prev && prev.tag !== 'time' && (EYEBROW_CLASS.test(prev.cls) || (textOf(prev).length <= 40 && EYEBROW_CLASS.test(prev.parent?.cls || '')));
  });
  const allowed = Math.max(1, Math.ceil(headings.length / 3));
  if (withEyebrow.length > allowed)
    add('taste-eyebrow-overuse', 'MEDIUM', `Подписей над заголовками ${withEyebrow.length} при ${headings.length} секциях (допустимо ≤ ${allowed})`, page, short(withEyebrow.map((h) => textOf(prevElement(h))).join(' | ')));

  // taste-number-labels: decorative zero-padded 01 / 02 / 03, 001 (a real count like 156 is not a label)
  // a <time> such as 03.10 is a date, not a label
  const numLabels = all(main, (n) => n.tag !== '#text' && n.tag !== 'time' && !n.parent.tag.startsWith('time') && elements(n).length === 0 && /^0\d{1,2}(\s*[\/·.]\s*\d{1,3})?$/.test(textOf(n)));
  if (numLabels.length >= 2) add('taste-number-labels', 'LOW', `Декоративная нумерация: ${numLabels.length} меток`, page, numLabels.slice(0, 4).map(textOf).join(', '));

  // taste-three-cards: exactly three identical feature cards with headings
  for (const n of walk(main)) {
    const kids = elements(n);
    if (kids.length !== 3) continue;
    const sig = kids[0].tag + '.' + kids[0].cls;
    if (!kids.every((k) => k.tag + '.' + k.cls === sig)) continue;
    if (!CARDISH.test(kids[0].cls) && !CARDISH.test(n.cls)) continue;
    if (!kids.every((k) => find(k, (x) => /^h[2-4]$/.test(x.tag)))) continue;
    add('taste-three-cards', 'MEDIUM', 'Три одинаковые карточки в ряд', page, short(`${n.tag}.${n.cls.split(' ')[0]} > ${sig.split(' ')[0]}: ` + kids.map((k) => textOf(find(k, (x) => /^h[2-4]$/.test(x.tag)))).join(' / ')));
  }

  // taste-section-repetition: 3+ consecutive top-level sections built as repeated-block grids
  const blocks = elements(main).filter((b) => ['section', 'div', 'article', 'header'].includes(b.tag));
  const family = (b) => {
    let best = 0;
    for (const n of walk(b)) {
      const kids = elements(n);
      if (kids.length < 3) continue;
      const counts = {};
      for (const k of kids) counts[k.tag + '.' + k.cls] = (counts[k.tag + '.' + k.cls] || 0) + 1;
      const [sig, c] = Object.entries(counts).sort((a, z) => z[1] - a[1])[0];
      if (c >= 3 && REPEATED_BLOCK.test(sig) && c > best) best = c;
    }
    return best >= 3 ? 'grid' : 'other';
  };
  let run = 0;
  for (const b of blocks) {
    run = family(b) === 'grid' ? run + 1 : 0;
    if (run === 3) add('taste-section-repetition', 'LOW', 'Три секции-сетки карточек подряд', page);
  }

  // taste-hero-overload: > 4 text blocks in the first block of main
  const hero = blocks[0];
  if (hero && find(hero, (n) => n.tag === 'h1')) {
    const parts = [];
    if (find(hero, (n) => EYEBROW_CLASS.test(n.cls))) parts.push('подпись');
    parts.push('заголовок');
    if (find(hero, (n) => n.tag === 'p' && textOf(n).length > 30)) parts.push('текст');
    if (find(hero, (n) => n.tag === 'a' && /(^|\s)btn/.test(n.cls)) || find(hero, (n) => n.tag === 'button')) parts.push('кнопки');
    if (find(hero, (n) => (n.tag === 'dl' || n.tag === 'ul' || n.tag === 'ol') && /stat|metric|number|fact|counter/i.test(n.cls))) parts.push('статистика');
    if (find(hero, (n) => /logo|trusted|clients|partners/i.test(n.cls))) parts.push('логотипы');
    if (parts.length > 4) add('taste-hero-overload', 'LOW', `В первом экране ${parts.length} текстовых блоков (≤ 4)`, page, parts.join(' + '));
  }

  // taste-middot: more than one "·" in a single short line
  for (const n of all(main, (x) => x.tag !== '#text' && elements(x).length === 0)) {
    const t = textOf(n);
    if (t.length < 120 && (t.match(/·/g) || []).length >= 2) add('taste-middot', 'LOW', 'Несколько «·» подряд как разделитель', page, short(t));
  }

  // taste-deco-strips: scroll cues and version stamps
  const bodyText = textOf(main);
  const deco = bodyText.match(/(scroll to explore|scroll\s*↓|↓\s*scroll|листайте вниз|\bv\d+\.\d+\.\d+(-rc\.\d+)?\b)/i);
  if (deco) add('taste-deco-strips', 'LOW', 'Декоративная подсказка прокрутки или номер версии', page, deco[0]);

  // taste-fake-provenance, taste-status-theatre: invented founding years and status widgets
  const prov = bodyText.match(/\b(?:est\.?|estd\.?|established)\s*(?:in\s*)?(?:19|20)\d\d\b|\bосн\.\s*(?:в\s*)?(?:19|20)\d\d\b/i);
  if (prov) add('taste-fake-provenance', 'LOW', 'Штамп родословной («Est. 2018»): правда ли это и нужен ли он', page, prov[0]);
  const status = bodyText.match(/all systems (?:operational|normal|go)|build (?:passing|green)|uptime\s*\d{2}(?:\.\d+)?\s*%|все системы работают/i);
  if (status) add('taste-status-theatre', 'LOW', 'Строка статуса на маркетинговой странице: есть ли за ней настоящий мониторинг', page, status[0]);
  // taste-vertical-text: sideways text set in the page's own CSS or inline styles
  const vertical = html.match(/writing-mode\s*:\s*(?:vertical-(?:rl|lr)|sideways-(?:rl|lr))/i);
  if (vertical) add('taste-vertical-text', 'LOW', 'Вертикальный текст: несёт ли он смысл или это декор края', page, vertical[0]);

  // taste-dash: English pages only, in headings, buttons and labels
  if (lang === 'en') {
    for (const n of all(main, (x) => /^h[1-3]$/.test(x.tag) || x.tag === 'button' || (x.tag === 'a' && /(^|\s)btn/.test(x.cls)) || EYEBROW_CLASS.test(x.cls))) {
      const t = textOf(n);
      if (/—|\s–\s/.test(t)) add('taste-dash', 'LOW', 'Тире в заголовке, кнопке или подписи (EN)', page, short(t));
    }
  }

  // taste-self-host-fonts
  if (all(doc, (x) => x.tag === 'link' && /^https:\/\/fonts\.googleapis\.com/i.test(attr(x.attrs, 'href'))).length)
    add('taste-self-host-fonts', 'LOW', 'Шрифты подключены ссылкой на Google Fonts, а не хранятся на своём домене', page);

  // taste-placeholder
  const ph = bodyText.match(PLACEHOLDER);
  if (ph) add('taste-placeholder', 'MEDIUM', 'Текст-заглушка в опубликованной странице', page, ph[0]);

  // taste-copy-cliche
  const cl = bodyText.match(CLICHE_EN) || bodyText.match(CLICHE_RU);
  if (cl) add('taste-copy-cliche', 'LOW', 'Штамп ИИ-копирайта', page, cl[0]);

  // taste-dead-link
  for (const a of all(doc, (x) => x.tag === 'a')) {
    const href = attr(a.attrs, 'href');
    if (href.trim() === '#' || /\shref\s*=\s*(""|'')/.test(a.attrs)) add('taste-dead-link', 'MEDIUM', 'Ссылка никуда не ведёт (href="#")', page, short(textOf(a) || a.cls));
  }
}
