// Runtime web design checks. Evaluate this whole file as one expression in the page
// (e.g. pass its text to a browser "execute JavaScript" tool). Returns a JSON-serializable report.
// Run per page type, per language, at 375 / 768 / 1024 / 1440 px.
(() => {
  const LIMIT = 15;
  const vw = window.innerWidth;

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
      if (n.tagName === 'DETAILS' && !n.open && !el.closest('summary') && n !== el && n.contains(el)) return false;
    }
    return true;
  };
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ''}`;
  };

  // ---- color math ----
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const lum = ({ r, g, b }) => {
    const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  // Effective background: composite ancestors' background colors; null if an image/gradient is underneath.
  const effectiveBg = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none' && !/gradient/.test(s.backgroundImage)) return null;
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a === 1) break;
      }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    const rootBg = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (rootBg && rootBg.a > 0) bg = blend(rootBg, bg);
    for (const l of layers.reverse()) bg = blend(l, bg);
    return bg;
  };
  const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

  const report = { url: location.pathname, viewport: `${vw}x${window.innerHeight}`, lang: document.documentElement.lang || null };

  // horizontal-scroll
  const overflow = document.documentElement.scrollWidth - vw;
  report.horizontalOverflowPx = overflow;
  if (overflow > 0) {
    report.overflowCulprits = [...document.body.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > vw + 1 && isVisible(el))
      .filter((el) => !el.closest('[style*="overflow"], pre, table'))
      .slice(0, LIMIT)
      .map((el) => `${describe(el)} right=${Math.round(el.getBoundingClientRect().right)}`);
  }

  // color-contrast (actual rendered text)
  const seen = new Set();
  const contrastFails = [];
  let textNodesChecked = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (t) => (t.textContent.trim().length > 1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    if (!el || seen.has(el) || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) || !isVisible(el)) continue;
    seen.add(el);
    textNodesChecked++;
    const s = getComputedStyle(el);
    const fg = parse(s.color);
    const bg = effectiveBg(el);
    if (!fg || !bg) continue;
    const size = parseFloat(s.fontSize);
    const bold = +s.fontWeight >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const r = ratio(blend(fg, bg), bg);
    const need = large ? 3 : 4.5;
    if (r < need) contrastFails.push({ el: describe(el), ratio: +r.toFixed(2), need, fg: hex(blend(fg, bg)), bg: hex(bg), fontSize: size });
  }
  const groupedContrast = {};
  for (const f of contrastFails) {
    const k = `${f.fg} on ${f.bg} @${f.fontSize}px`;
    (groupedContrast[k] ??= { ratio: f.ratio, need: f.need, count: 0, examples: [] }).count++;
    if (groupedContrast[k].examples.length < 3) groupedContrast[k].examples.push(f.el);
  }
  report.contrast = { textElementsChecked: textNodesChecked, failures: groupedContrast };

  // readable-font-size
  report.tinyText = [...seen]
    .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 12)
    .slice(0, LIMIT)
    .map((el) => `${describe(el)} ${getComputedStyle(el).fontSize}`);
  if (vw < 768) {
    const p = [...document.querySelectorAll('main p')].filter(isVisible);
    const small = p.filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16);
    if (small.length) report.bodyTextUnder16OnMobile = small.slice(0, 5).map((el) => `${describe(el)} ${getComputedStyle(el).fontSize}`);
  }

  // line-length (chars per line, approx via average glyph width 0.5em)
  report.longLines = [...document.querySelectorAll('main p, main li')]
    .filter((el) => isVisible(el) && el.innerText.length > 120)
    .map((el) => ({ el, cpl: Math.round(el.getBoundingClientRect().width / (parseFloat(getComputedStyle(el).fontSize) * 0.5)) }))
    .filter((x) => x.cpl > 90)
    .slice(0, 5)
    .map((x) => `${describe(x.el)} ≈${x.cpl} chars/line`);

  // web-target-size (24px) and touch-comfort (44px on mobile)
  const interactive = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex]:not([tabindex="-1"])')].filter(isVisible);
  const inlineInText = (el) => el.tagName === 'A' && el.closest('p, li') && getComputedStyle(el).display === 'inline';
  report.targetsUnder24 = interactive
    .filter((el) => !inlineInText(el))
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width < 24 || r.height < 24;
    })
    .slice(0, LIMIT)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return `${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    });
  if (vw < 768) {
    report.targetsUnder44OnMobile = interactive
      .filter((el) => !inlineInText(el) && el.closest('header, nav, form, [class*=btn], button'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height < 44 && r.width < 44;
      })
      .slice(0, LIMIT)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return `${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`;
      });
  }

  // focus-not-obscured: sticky/fixed header vs scroll-padding-top
  const stickies = [...document.querySelectorAll('body *')].filter((el) => {
    const p = getComputedStyle(el).position;
    return (p === 'sticky' || p === 'fixed') && isVisible(el) && el.getBoundingClientRect().top <= 1 && el.getBoundingClientRect().width > vw * 0.5;
  });
  if (stickies.length) {
    const h = Math.max(...stickies.map((el) => el.getBoundingClientRect().height));
    const spt = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    report.stickyHeader = { heightPx: Math.round(h), scrollPaddingTopPx: spt, focusMayBeObscured: spt < h };
  }

  // focus-states. Programmatic focus does not trigger :focus-visible, so instead of focusing,
  // match elements against author CSS rules that style :focus / :focus-visible.
  // Approximate specificity [ids, classes/attrs/pseudo-classes, elements] as a sortable number.
  const specificity = (sel) => {
    const s = sel.replace(/::?(before|after|placeholder|marker)\b/g, '').replace(/:(not|is|where|has)\(([^)]*)\)/g, (m, fn, inner) => (fn === 'where' ? '' : ' ' + inner));
    const ids = (s.match(/#[\w-]+/g) || []).length;
    const cls = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
    const els = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+(\([^)]*\))?/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
    return ids * 10000 + cls * 100 + els;
  };
  const focusSelectors = [];
  const outlineRemovers = [];
  let order = 0;
  const collect = (rules) => {
    for (const r of rules) {
      if (r.cssRules && !r.selectorText) collect(r.cssRules); // @media, @layer, @supports
      if (!r.selectorText) continue;
      order++;
      const s = r.style;
      const removes = s.outlineStyle === 'none' || /^(none|0(px)?)\b/.test(s.outline || '') || s.outlineWidth === '0px';
      const restores = /:focus(-visible)?\b/.test(r.selectorText) && ((s.outlineStyle && s.outlineStyle !== 'none' && s.outlineWidth !== '0px') || (s.boxShadow && s.boxShadow !== 'none') || s.backgroundColor || s.borderColor || s.textDecoration);
      for (const sel of r.selectorText.split(',')) {
        const entry = { base: sel.replace(/:focus(-visible|-within)?\b/g, '').trim() || '*', spec: specificity(sel), order };
        if (removes) outlineRemovers.push(entry);
        if (restores && /:focus(-visible)?\b/.test(sel)) focusSelectors.push(entry);
      }
    }
  };
  let cssReadable = true;
  for (const sheet of document.styleSheets) {
    try {
      collect(sheet.cssRules);
    } catch {
      cssReadable = false; // cross-origin stylesheet
    }
  }
  const strongest = (el, list) => {
    let best = null;
    for (const e of list) {
      let ok = false;
      try {
        ok = el.matches(e.base.replace(/::?(before|after)$/, '') || '*');
      } catch {}
      if (ok && (!best || e.spec > best.spec || (e.spec === best.spec && e.order > best.order))) best = e;
    }
    return best;
  };
  // Missing = the winning outline-removing rule beats every focus-restoring rule for this element.
  report.focusIndicatorMissing = interactive
    .filter((el) => {
      const kill = strongest(el, outlineRemovers);
      if (!kill) return false;
      const back = strongest(el, focusSelectors);
      return !back || kill.spec > back.spec || (kill.spec === back.spec && kill.order > back.order);
    })
    .slice(0, LIMIT)
    .map(describe);
  report.focusNote = `${focusSelectors.length} author focus rules found${cssReadable ? '' : ' (some cross-origin sheets unreadable)'}. Browser default ring applies where outline is not removed. Confirm visually with real Tab presses.`;

  // images: oversized, missing dimensions, lazy above the fold
  const dpr = window.devicePixelRatio || 1;
  report.images = [...document.images]
    .filter(isVisible)
    .map((img) => {
      const r = img.getBoundingClientRect();
      const issues = [];
      if (img.naturalWidth > r.width * dpr * 2.2 && img.naturalWidth > 400) issues.push(`oversized ${img.naturalWidth}px for ${Math.round(r.width)}px slot`);
      if (!img.getAttribute('width') || !img.getAttribute('height')) issues.push('no width/height');
      if (img.loading === 'lazy' && r.top < window.innerHeight && window.scrollY === 0) issues.push('lazy above the fold');
      if (!img.hasAttribute('alt')) issues.push('no alt');
      return issues.length ? `${img.currentSrc.split('/').slice(-2).join('/')}: ${issues.join('; ')}` : null;
    })
    .filter(Boolean)
    .slice(0, LIMIT);
  report.autoplayMedia = [...document.querySelectorAll('video[autoplay], img[src$=".gif"]')].filter(isVisible).length;

  // headings outline & landmarks
  report.headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(isVisible).map((h) => `${h.tagName.toLowerCase()}: ${h.innerText.trim().slice(0, 50)}`).slice(0, 25);
  report.landmarks = { header: !!document.querySelector('header'), nav: document.querySelectorAll('nav').length, main: !!document.querySelector('main'), footer: !!document.querySelector('footer') };

  // nav-state-active
  report.navCurrent = [...document.querySelectorAll('nav [aria-current]')].filter(isVisible).map(describe);

  // text truncation / clipping
  report.clippedText = [...seen]
    .filter((el) => {
      const s = getComputedStyle(el);
      return (s.overflow === 'hidden' || s.textOverflow === 'ellipsis') && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    })
    .slice(0, LIMIT)
    .map(describe);

  return report;
})();
