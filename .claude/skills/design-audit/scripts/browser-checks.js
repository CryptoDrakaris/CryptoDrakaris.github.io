(() => {
  // Runtime web design checks. The whole file is one expression: evaluate it as is, wrapped in
  // parentheses or after `return` (browser "execute JavaScript" tools differ). Returns a
  // JSON-serializable report. Run per page type, per language, at 375 / 768 / 1024 / 1440 px.
  // window.__auditLimit sets how many examples each list keeps (default 15).
  const LIMIT = window.__auditLimit || 15;
  // window.__auditTimings = true adds report.timings (ms per section) to find slow parts on big pages
  const t0 = performance.now();
  const timings = window.__auditTimings ? {} : null;
  const mark = (k) => timings && (timings[k] = Math.round(performance.now() - t0));
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const styleCache = new Map();
  const cs = (el) => {
    let s = styleCache.get(el);
    if (!s) styleCache.set(el, (s = getComputedStyle(el)));
    return s;
  };
  // the parent across shadow DOM boundaries
  const up = (n) => n.parentElement || (n.getRootNode && n.getRootNode() !== document ? n.getRootNode().host : null) || null;
  const holds = (a, b) => {
    for (let n = b; n; n = up(n)) if (n === a) return true;
    return false;
  };

  // visually hidden (sr-only) content is meant for screen readers and has no visible size
  const srOnly = (el, r = el.getBoundingClientRect()) => {
    const s = cs(el);
    return (r.width <= 1 && r.height <= 1) || /rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/.test(s.clip) || s.clipPath === 'inset(50%)';
  };
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    if (el.checkVisibility) return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    for (let n = el; n; n = up(n)) {
      const s = cs(n);
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
  // Computed colours come as rgb(), but also oklch(), lab(), color(srgb …) (color-mix, modern
  // CSS). A 1×1 canvas converts any of them to sRGB bytes.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const colorCache = new Map();
  const parse = (c) => {
    if (!c || /^(none|initial|inherit|auto|invert|currentcolor)$/i.test(c)) return null;
    if (colorCache.has(c)) return colorCache.get(c);
    let out = null;
    const m = c.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean);
      out = { r: +p[0], g: +p[1], b: +p[2], a: p[3] === undefined ? 1 : p[3].endsWith('%') ? parseFloat(p[3]) / 100 : +p[3] };
    } else if (ctx) {
      ctx.fillStyle = '#010203';
      ctx.fillStyle = c;
      if (ctx.fillStyle !== '#010203' || /^#010203$/i.test(c)) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        out = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
      }
    }
    colorCache.set(c, out);
    return out;
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
  const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  const COLOR_IN = /(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\((?:[^()]|\([^()]*\))*\)|#[0-9a-f]{3,8}\b/gi;
  // opacity multiplies down the tree: an ancestor at .35 fades its text and backgrounds
  const opacityOf = (el) => {
    let o = 1;
    for (let n = el; n; n = up(n)) o *= +cs(n).opacity;
    return o;
  };
  // ---- gradients ----
  // A simple linear or radial gradient is evaluated at the points under the text, so a glow
  // in the far corner does not count against a caption in the near one. Anything else
  // (conic, repeating, sized or fixed layers, hints, calc) gives every stop, marked uncertain.
  const splitTop = (s) => {
    const out = [];
    let depth = 0, from = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
      else if (s[i] === ',' && !depth) (out.push(s.slice(from, i).trim()), (from = i + 1));
    }
    out.push(s.slice(from).trim());
    return out;
  };
  // a length or percentage as a fraction of `full` px; NaN when it is not one
  const frac = (v, full) => (/^-?[\d.]+%$/.test(v) ? parseFloat(v) / 100 : /^-?[\d.]+px$/.test(v) ? parseFloat(v) / full : /^0$/.test(v) ? 0 : NaN);
  const ANGLE = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 };
  // stops → [{c, t}] with every position resolved (CSS Images 3, "color stop fixup"); null if unsupported
  const resolveStops = (args, rayPx) => {
    const stops = [];
    for (const a of args) {
      const m = a.match(COLOR_IN);
      if (!m || a.indexOf(m[0]) !== 0) return null; // an interpolation hint
      const c = parse(m[0]);
      if (!c) return null;
      const pos = a.slice(m[0].length).trim().split(/\s+/).filter(Boolean).map((p) => frac(p, rayPx));
      if (pos.some(Number.isNaN)) return null;
      if (!pos.length) stops.push({ c, t: null });
      for (const t of pos) stops.push({ c, t });
    }
    if (stops.length < 2) return null;
    if (stops[0].t === null) stops[0].t = 0;
    if (stops[stops.length - 1].t === null) stops[stops.length - 1].t = 1;
    let max = -Infinity;
    for (const s of stops) if (s.t !== null) s.t = max = Math.max(max, s.t);
    for (let i = 1; i < stops.length; i++) {
      if (stops[i].t !== null) continue;
      let j = i;
      while (stops[j].t === null) j++;
      const a = stops[i - 1].t, step = (stops[j].t - a) / (j - i + 1);
      for (let k = i; k < j; k++) stops[k].t = a + step * (k - i + 1);
    }
    return stops;
  };
  // colour at t, interpolated in premultiplied sRGB as browsers paint it
  const colorAt = (stops, t) => {
    if (t <= stops[0].t) return stops[0].c;
    for (let i = 1; i < stops.length; i++) {
      if (t > stops[i].t) continue;
      const a = stops[i - 1].c, b = stops[i].c, span = stops[i].t - stops[i - 1].t;
      const k = span > 0 ? (t - stops[i - 1].t) / span : 1;
      const al = a.a + (b.a - a.a) * k;
      if (al <= 0) return { r: 0, g: 0, b: 0, a: 0 };
      const ch = (x) => (a[x] * a.a + (b[x] * b.a - a[x] * a.a) * k) / al;
      return { r: ch('r'), g: ch('g'), b: ch('b'), a: al };
    }
    return stops[stops.length - 1].c;
  };
  const POS = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
  // gradient layer → its stops and the colour at a point (px, relative to the box), or null
  const gradientAt = (layer, W, H) => {
    const m = layer.match(/^(linear|radial)-gradient\((.*)\)$/s);
    if (!m || !W || !H) return null;
    const args = splitTop(m[2]);
    const first = args[0];
    const isColor = (a) => { const c = a.match(COLOR_IN); return c && a.indexOf(c[0]) === 0; };
    const conf = isColor(first) ? '' : args.shift();
    if (/\bin\s|calc\(|var\(/.test(conf)) return null;
    if (m[1] === 'linear') {
      let dx = 0, dy = 1; // to bottom
      const deg = conf.match(/^(-?[\d.]+)(deg|grad|rad|turn)$/);
      if (deg) {
        const th = (parseFloat(deg[1]) * ANGLE[deg[2]] * Math.PI) / 180;
        (dx = Math.sin(th)), (dy = -Math.cos(th));
      } else if (conf) {
        const to = conf.match(/^to\s+(.+)$/);
        if (!to) return null;
        const w = to[1].split(/\s+/);
        const sx = w.includes('left') ? -1 : w.includes('right') ? 1 : 0, sy = w.includes('top') ? -1 : w.includes('bottom') ? 1 : 0;
        if (sx && sy) (dx = sx * H), (dy = sy * W); // a corner: the 50% line joins the other two corners
        else (dx = sx), (dy = sy);
        const n = Math.hypot(dx, dy);
        if (!n) return null;
        (dx /= n), (dy /= n);
      }
      const L = Math.abs(W * dx) + Math.abs(H * dy);
      const stops = resolveStops(args, L);
      return stops && { stops, at: (x, y) => colorAt(stops, ((x - W / 2) * dx + (y - H / 2) * dy) / L + 0.5) };
    }
    // radial: [shape] [size] [at x y]
    const [shapeSize, at = 'center'] = conf.split(/\s*\bat\s+/);
    const p = at.split(/\s+/).filter(Boolean);
    if (p.length === 1) p.push('center');
    if (p.length !== 2) return null;
    if (POS[p[0]] !== undefined && (p[0] === 'top' || p[0] === 'bottom')) p.reverse();
    const cx = (POS[p[0]] ?? frac(p[0], W)) * W, cy = (POS[p[1]] ?? frac(p[1], H)) * H;
    if (Number.isNaN(cx) || Number.isNaN(cy)) return null;
    const words = shapeSize.split(/\s+/).filter(Boolean);
    const lens = words.filter((w) => !/^(circle|ellipse|closest-side|closest-corner|farthest-side|farthest-corner)$/.test(w));
    const circle = words.includes('circle') || (!words.includes('ellipse') && lens.length === 1);
    const key = words.find((w) => /-(side|corner)$/.test(w)) || (lens.length ? '' : 'farthest-corner');
    const sideX = [cx, W - cx].map(Math.abs), sideY = [cy, H - cy].map(Math.abs);
    let rx, ry;
    if (lens.length) {
      rx = frac(lens[0], 1) * (lens[0].endsWith('%') ? W : 1);
      ry = circle ? rx : frac(lens[1] ?? '', 1) * ((lens[1] || '').endsWith('%') ? H : 1);
    } else {
      const pick = key.startsWith('closest') ? Math.min : Math.max;
      let a = pick(...sideX), b = pick(...sideY);
      if (circle) {
        const r = key.endsWith('corner') ? Math.hypot(a, b) : pick(a, b);
        (rx = r), (ry = r);
      } else (rx = key.endsWith('corner') ? a * Math.SQRT2 : a), (ry = key.endsWith('corner') ? b * Math.SQRT2 : b);
    }
    if (!(rx > 0 && ry > 0)) return null;
    const stops = resolveStops(args, rx);
    return stops && { stops, at: (x, y) => colorAt(stops, Math.hypot((x - cx) / rx, (y - cy) / ry)) };
  };
  // where the text of el is drawn: its own text lines, else its box
  const textArea = (el) => {
    const r = document.createRange();
    let box = null;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      r.selectNodeContents(n);
      const b = r.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      box = box ? { left: Math.min(box.left, b.left), top: Math.min(box.top, b.top), right: Math.max(box.right, b.right), bottom: Math.max(box.bottom, b.bottom) } : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    }
    return box || el.getBoundingClientRect();
  };
  // Background under an element as candidate colours: composite the layers down to the first
  // opaque one over the white canvas at nine points of `area` (the text by default). An
  // unsupported gradient adds each of its stops and marks the result .uncertain. null when a
  // picture lies underneath.
  const backgrounds = (el, area = textArea(el)) => {
    const layers = [];
    let uncertain = false;
    for (let n = el; n; n = up(n)) {
      const s = cs(n);
      const op = opacityOf(n);
      const img = s.backgroundImage;
      let opaque = false;
      if (img && img !== 'none') {
        if (/url\(|image-set|element\(|cross-fade/.test(img)) return null;
        // the root background (or the body's, carried to the canvas) is laid out on the root box
        const html = document.documentElement, hs = cs(html);
        const root = n === html || (n === document.body && hs.backgroundImage === 'none' && !(parse(hs.backgroundColor)?.a > 0));
        const box = (root ? html : n).getBoundingClientRect();
        const bl = root ? 0 : parseFloat(s.borderLeftWidth) || 0, bt = root ? 0 : parseFloat(s.borderTopWidth) || 0;
        const W = root ? box.width : box.width - bl - (parseFloat(s.borderRightWidth) || 0), H = root ? box.height : box.height - bt - (parseFloat(s.borderBottomWidth) || 0);
        const [sizes, poss, atts, origins] = [s.backgroundSize, s.backgroundPosition, s.backgroundAttachment, s.backgroundOrigin].map(splitTop);
        const of = (list, i) => list[i % list.length];
        const nodeLayers = splitTop(img).flatMap((layer, i) => {
          if (layer === 'none') return []; // `background: <gradient>, <colour>` leaves an empty layer
          const plain = /^auto( auto)?$/.test(of(sizes, i)) && /^0% 0%$|^0px 0px$/.test(of(poss, i)) && of(atts, i) !== 'fixed' && of(origins, i) === 'padding-box';
          const g = plain ? gradientAt(layer, W, H) : null;
          if (g) return { opaque: op >= 1 && g.stops.every((x) => x.c.a >= 1), at: (x, y) => { const c = g.at(x - box.left - bl, y - box.top - bt); return { ...c, a: c.a * op }; } };
          const stops = (layer.match(COLOR_IN) || []).map(parse).filter(Boolean);
          if (!stops.length) return null;
          uncertain = true;
          return { all: stops.map((c) => ({ ...c, a: c.a * op })) };
        });
        if (nodeLayers.includes(null)) return null;
        layers.push(...nodeLayers);
        opaque = nodeLayers.some((l) => l.opaque || (l.all && l.all.every((c) => c.a >= 1)));
      }
      const c = parse(s.backgroundColor);
      if (!opaque && c && c.a > 0) {
        layers.push({ all: [{ ...c, a: c.a * op }] });
        opaque = c.a * op >= 1;
      }
      if (opaque) break;
    }
    layers.reverse();
    const xs = [area.left + 1, (area.left + area.right) / 2, area.right - 1], ys = [area.top + 1, (area.top + area.bottom) / 2, area.bottom - 1];
    const points = layers.some((l) => l.at) ? xs.flatMap((x) => ys.map((y) => [x, y])) : [[0, 0]]; // flat colours are the same everywhere
    const out = [];
    for (const [x, y] of points) {
      let cands = [WHITE];
      for (const l of layers) {
        const next = [];
        for (const b of cands) for (const c of l.all || [l.at(x, y)]) next.push(blend(c, b));
        next.sort((p, q) => lum(p) - lum(q));
        cands = next.length > 2 ? [next[0], next[next.length - 1]] : next;
      }
      out.push(...cands);
    }
    out.uncertain = uncertain;
    return out;
  };
  const worst = (fg, bgs) => {
    let best = null;
    for (const bg of bgs) {
      const f = fg.a < 1 ? blend(fg, bg) : fg;
      const r = ratio(f, bg);
      if (!best || r < best.ratio) best = { ratio: r, fg: f, bg };
    }
    return best;
  };

  const report = { url: location.pathname, viewport: `${vw}x${vh}`, lang: document.documentElement.lang || null };
  const notMeasured = {};
  const skip = (k) => (notMeasured[k] = (notMeasured[k] || 0) + 1);

  // elements of the page including open shadow roots
  const shadowRoots = [];
  const allElements = (root = document.body) => {
    const out = [];
    const walk = (r) => {
      for (const el of r.querySelectorAll('*')) {
        out.push(el);
        if (el.shadowRoot) (shadowRoots.push(el.shadowRoot), walk(el.shadowRoot));
      }
    };
    if (root) walk(root);
    return out;
  };
  const everything = allElements();
  notMeasured.iframes = document.querySelectorAll('iframe').length;

  mark('setup');
  // horizontal-scroll: report the outermost elements past the right edge, outside scroll containers
  const overflow = document.documentElement.scrollWidth - vw;
  report.horizontalOverflowPx = overflow;
  if (overflow > 0) {
    const inScroller = (el) => {
      for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) if (cs(n).overflowX !== 'visible') return true;
      return false;
    };
    const past = (el) => el && el.getBoundingClientRect().right > vw + 1;
    report.overflowCulprits = everything
      .filter((el) => past(el) && !past(el.parentElement) && isVisible(el) && !inScroller(el))
      .slice(0, LIMIT)
      .map((el) => `${describe(el)} right=${Math.round(el.getBoundingClientRect().right)}`);
  }

  mark('overflow');
  // color-contrast (actual rendered text)
  const seen = new Set();
  const contrastFails = [];
  let textNodesChecked = 0;
  const textOwners = [];
  const collectText = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (t.textContent.trim().length > 1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (el && !seen.has(el)) (seen.add(el), textOwners.push(el));
    }
  };
  if (document.body) collectText(document.body);
  for (const r of shadowRoots) collectText(r);
  const textEls = [];
  for (const el of textOwners) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName) || !isVisible(el) || srOnly(el)) continue;
    textEls.push(el);
    textNodesChecked++;
    const s = cs(el);
    if (s.backgroundClip === 'text' || s.webkitBackgroundClip === 'text') {
      skip('gradientText');
      continue;
    }
    const fg0 = parse(s.color);
    if (!fg0 || fg0.a === 0) {
      skip('unparsedColor');
      continue;
    }
    const bgs = backgrounds(el);
    if (!bgs) {
      skip('overImage');
      continue;
    }
    const fg = { ...fg0, a: fg0.a * opacityOf(el) };
    const size = parseFloat(s.fontSize);
    const bold = +s.fontWeight >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const w = worst(fg, bgs);
    const need = large ? 3 : 4.5;
    if (w.ratio < need) {
      // text over a positioned sibling (a dark layer, a picture) has a background the tree does not show
      const r = el.getBoundingClientRect();
      const cx = r.left + Math.min(r.width / 2, 20), cy = r.top + r.height / 2;
      const other = cx >= 0 && cy >= 0 && cx < vw && cy < vh ? document.elementsFromPoint(cx, cy).find((e) => e !== el && !el.contains(e)) : null;
      const layered = !!other && !holds(other, el);
      const uncertain = layered || bgs.uncertain;
      const why = layered ? 'over another layer' : 'gradient not measured at the text';
      contrastFails.push({ el: describe(el) + (uncertain ? ` (${why}: verify by eye)` : ''), uncertain, ratio: +w.ratio.toFixed(2), need, fg: hex(w.fg), bg: hex(w.bg), fontSize: size });
    }
  }
  const groupedContrast = {};
  for (const f of contrastFails) {
    const k = `${f.fg} on ${f.bg} @${f.fontSize}px`;
    const g = (groupedContrast[k] ??= { ratio: f.ratio, need: f.need, count: 0, uncertain: 0, examples: [] });
    g.count++;
    if (f.uncertain) g.uncertain++;
    if (g.examples.length < 3) g.examples.push(f.el);
  }
  report.contrast = { textElementsChecked: textNodesChecked, failures: groupedContrast };

  mark('contrast');
  // readable-font-size
  report.tinyText = textEls
    .filter((el) => parseFloat(cs(el).fontSize) < 12)
    .slice(0, LIMIT)
    .map((el) => `${describe(el)} ${cs(el).fontSize}`);
  if (vw < 768) {
    const p = [...document.querySelectorAll('main p')].filter(isVisible);
    const small = p.filter((el) => parseFloat(cs(el).fontSize) < 16);
    if (small.length) report.bodyTextUnder16OnMobile = small.slice(0, 5).map((el) => `${describe(el)} ${cs(el).fontSize}`);
  }

  // line-length (chars per line, approx via average glyph width 0.5em)
  report.longLines = [...document.querySelectorAll('main p, main li')]
    .filter((el) => isVisible(el) && el.innerText.length > 120)
    .map((el) => ({ el, cpl: Math.round(el.getBoundingClientRect().width / (parseFloat(cs(el).fontSize) * 0.5)) }))
    .filter((x) => x.cpl > 90)
    .slice(0, 5)
    .map((x) => `${describe(x.el)} ≈${x.cpl} chars/line`);

  mark('text');
  // web-target-size (24px, WCAG 2.5.8) and touch-comfort (44px on mobile)
  const interactive = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex]:not([tabindex="-1"])')].filter((el) => isVisible(el) && !srOnly(el));
  const interactiveSet = new Set(interactive);
  // exceptions: a link inside a line of text, a control the browser draws itself
  const inlineInText = (el) => {
    if (cs(el).display !== 'inline') return false;
    const p = el.parentElement;
    return !!p && [...p.childNodes].some((n) => n !== el && n.nodeType === 3 && n.textContent.trim());
  };
  const uaControl = (el) => el.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(el.type) && cs(el).appearance !== 'none';
  const rects = new Map(interactive.map((el) => [el, el.getBoundingClientRect()]));
  const small24 = interactive.filter((el) => {
    const r = rects.get(el);
    return (r.width < 24 || r.height < 24) && !inlineInText(el) && !uaControl(el);
  });
  const small24Set = new Set(small24);
  // spacing exception: a 24px circle around the target touches no other target or circle.
  // Targets are bucketed in a 48px grid, so each one is compared with its neighbours only.
  const CELL = 48;
  const grid = new Map();
  for (const [el, r] of rects)
    for (let gx = Math.floor(r.left / CELL); gx <= Math.floor(r.right / CELL); gx++)
      for (let gy = Math.floor(r.top / CELL); gy <= Math.floor(r.bottom / CELL); gy++) {
        const k = gx + ',' + gy;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(el);
      }
  const spaced = (el) => {
    const a = rects.get(el);
    const cx = a.left + a.width / 2, cy = a.top + a.height / 2;
    const near = new Set();
    for (let gx = Math.floor((cx - 24) / CELL); gx <= Math.floor((cx + 24) / CELL); gx++)
      for (let gy = Math.floor((cy - 24) / CELL); gy <= Math.floor((cy + 24) / CELL); gy++) for (const o of grid.get(gx + ',' + gy) || []) near.add(o);
    for (const o of near) {
      if (o === el || o.contains(el) || el.contains(o)) continue;
      const b = rects.get(o);
      const dx = Math.max(b.left - cx, 0, cx - b.right), dy = Math.max(b.top - cy, 0, cy - b.bottom);
      if (Math.hypot(dx, dy) < 12) return false;
      if (small24Set.has(o) && Math.hypot(b.left + b.width / 2 - cx, b.top + b.height / 2 - cy) < 24) return false;
    }
    return true;
  };
  const size = (el) => `${describe(el)} ${Math.round(rects.get(el).width)}x${Math.round(rects.get(el).height)}`;
  report.targetsUnder24 = small24.filter((el) => !spaced(el)).slice(0, LIMIT).map(size);
  if (vw < 768) {
    report.targetsUnder44OnMobile = interactive
      .filter((el) => !inlineInText(el) && !uaControl(el) && el.closest('header, nav, form, [class*=btn], button'))
      .filter((el) => rects.get(el).height < 44 && rects.get(el).width < 44)
      .slice(0, LIMIT)
      .map(size);
  }

  mark('targets');
  // focus-not-obscured: a sticky/fixed header on screen vs scroll-padding-top
  const stickies = everything.filter((el) => {
    const p = cs(el).position;
    if (p !== 'sticky' && p !== 'fixed') return false;
    const r = el.getBoundingClientRect();
    return r.top <= 1 && r.bottom > 0 && r.width > vw * 0.5 && isVisible(el);
  });
  if (stickies.length) {
    const h = Math.max(...stickies.map((el) => el.getBoundingClientRect().bottom));
    const spt = parseFloat(cs(document.documentElement).scrollPaddingTop) || 0;
    report.stickyHeader = { heightPx: Math.round(h), scrollPaddingTopPx: spt, focusMayBeObscured: spt < h };
  }

  mark('sticky');
  // ---- author CSS, flattened: @import, @media/@supports/@layer, nested rules (&), adopted sheets,
  // open shadow roots. Each rule keeps its media conditions and its scope for querySelectorAll.
  const styleRules = [];
  let cssReadable = true;
  let order = 0;
  const nest = (sel, parent) => {
    if (!parent) return sel;
    const p = parent.includes(',') ? `:is(${parent})` : parent;
    return sel
      .split(/,(?![^(]*\))/)
      .map((s) => (s.includes('&') ? s.replace(/&/g, p) : `${p} ${s.trim()}`))
      .join(', ');
  };
  const visit = (rules, parentSel, media, scope) => {
    for (const r of rules) {
      if (r.type === 3 /* @import */) {
        try {
          if (r.styleSheet) visit(r.styleSheet.cssRules, null, r.media && r.media.mediaText ? [...media, r.media.mediaText] : media, scope);
        } catch {
          cssReadable = false;
        }
        continue;
      }
      if (r.selectorText !== undefined) {
        const sel = nest(r.selectorText, parentSel);
        styleRules.push({ sel, style: r.style, media, scope, order: ++order });
        if (r.cssRules && r.cssRules.length) visit(r.cssRules, sel, media, scope);
      } else if (r.cssRules) visit(r.cssRules, parentSel, r.media ? [...media, r.media.mediaText] : r.conditionText ? [...media, r.conditionText] : media, scope);
      else if (r.style && parentSel) styleRules.push({ sel: parentSel, style: r.style, media, scope, order: ++order }); // nested declarations
    }
  };
  const sheetsOf = (root) => [...(root.styleSheets || []), ...(root.adoptedStyleSheets || [])];
  for (const scope of [document, ...shadowRoots])
    for (const sheet of sheetsOf(scope)) {
      try {
        visit(sheet.cssRules, null, [], scope);
      } catch {
        cssReadable = false; // cross-origin stylesheet
      }
    }

  mark('cssRules');
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
  const FOCUS = /:focus(-visible)?(?![\w-])/;
  const baseOf = (sel) => sel.replace(/:focus(-visible|-within)?(?![\w-])/g, '').replace(/::?(before|after)$/, '').trim() || '*';
  const kills = (s) => s.outlineStyle === 'none' || s.outlineWidth === '0px' || /^(none|0(px)?)\b/.test(s.outline || '');
  const outlineRestorers = [], otherRestorers = [], outlineRemovers = [], ringRules = [];
  for (const r of styleRules) {
    const s = r.style;
    const removes = kills(s);
    const ringColor = !removes && s.outlineColor && !/^(initial|inherit|unset|auto|invert)$/i.test(s.outlineColor) ? s.outlineColor : null;
    const outline = !removes && ((s.outlineStyle && s.outlineStyle !== 'none') || (s.outlineWidth && s.outlineWidth !== '0px'));
    const other = (s.boxShadow && s.boxShadow !== 'none') || s.backgroundColor || s.borderColor || (s.textDecoration && s.textDecoration !== 'none');
    for (const sel of r.sel.split(/,(?![^(]*\))/)) {
      // :focus:not(:focus-visible) only removes the ring for mouse clicks
      if (/:not\(\s*:focus-visible\s*\)/.test(sel)) continue;
      const entry = { base: baseOf(sel), spec: specificity(sel), order: r.order, scope: r.scope };
      if (removes) outlineRemovers.push(entry);
      if (!FOCUS.test(sel)) continue;
      if (outline) outlineRestorers.push(entry);
      if (other) otherRestorers.push(entry);
      if (ringColor) ringRules.push({ ...entry, color: ringColor });
    }
  }
  // strongest rule per interactive element: one querySelectorAll per rule, not one matches() per pair
  const strongest = (list) => {
    const best = new Map();
    for (const e of list) {
      let els;
      try {
        els = e.scope.querySelectorAll(e.base);
      } catch {
        continue;
      }
      for (const el of els) {
        if (!interactiveSet.has(el)) continue;
        const b = best.get(el);
        if (!b || e.spec > b.spec || (e.spec === b.spec && e.order > b.order)) best.set(el, e);
      }
    }
    return best;
  };
  const killBy = strongest(outlineRemovers), backBy = strongest(outlineRestorers), otherBy = strongest(otherRestorers);
  // Missing = the winning outline-removing rule beats every outline-restoring rule for this
  // element and no focus rule draws another indicator (box-shadow, background, border).
  report.focusIndicatorMissing = interactive
    .filter((el) => {
      const kill = killBy.get(el);
      if (!kill || otherBy.has(el)) return false;
      const back = backBy.get(el);
      return !back || kill.spec > back.spec || (kill.spec === back.spec && kill.order > back.order);
    })
    .slice(0, LIMIT)
    .map(describe);
  // forced-colors (Windows contrast themes) drops box-shadow: a ring made only of box-shadow vanishes.
  // Keep a transparent outline next to it (outline: 2px solid transparent), forced colors paint it.
  report.focusOnlyBoxShadow = interactive.filter((el) => killBy.has(el) && otherBy.has(el) && !backBy.has(el)).slice(0, LIMIT).map(describe);
  report.focusNote = `${outlineRestorers.length + otherRestorers.length} author focus rules found${cssReadable ? '' : ' (some cross-origin sheets unreadable)'}. Browser default ring applies where outline is not removed. Confirm visually with real Tab presses.`;

  mark('focus');
  // focus-ring-background: the ring is drawn outside the element (outline-offset >= 0), so it
  // must read against the parent's background, not the element's own. Catches cards that carry
  // their own theme (data-theme) and recolor the ring with an accent made for another surface.
  // The ring colour is resolved on the element itself (its custom properties and currentColor
  // apply), through a property nothing else uses, so void elements such as <input> work too.
  const probeProp = 'textEmphasisColor' in document.documentElement.style ? 'text-emphasis-color' : '-webkit-text-emphasis-color';
  const resolveOn = (el, value) => {
    const st = el.style;
    const hadStyle = el.hasAttribute('style');
    const prev = st.getPropertyValue(probeProp), pri = st.getPropertyPriority(probeProp);
    st.setProperty(probeProp, value, 'important');
    const c = parse(getComputedStyle(el).getPropertyValue(probeProp));
    if (prev) st.setProperty(probeProp, prev, pri);
    else st.removeProperty(probeProp);
    if (!hadStyle && !st.length) el.removeAttribute('style');
    return c;
  };
  const ringBy = strongest(ringRules);
  const ringSeen = new Map();
  for (const el of interactive) {
    if (el.getAttribute('tabindex') === '-1' || el.closest('[aria-hidden="true"], [inert]')) continue; // never focused by keyboard
    const rule = ringBy.get(el);
    if (!rule) continue;
    const kill = killBy.get(el);
    if (kill && (kill.spec > rule.spec || (kill.spec === rule.spec && kill.order > rule.order))) continue; // reported as missing
    const fg = /var\(|currentcolor/i.test(rule.color) ? resolveOn(el, rule.color) : parse(rule.color);
    const bgs = up(el) ? backgrounds(up(el), el.getBoundingClientRect()) : [WHITE];
    if (!fg || !bgs) continue;
    const w = worst(fg, bgs);
    if (w.ratio >= 3) continue;
    const k = `${hex(w.fg)} on ${hex(w.bg)}`;
    if (!ringSeen.has(k)) ringSeen.set(k, { ratio: +w.ratio.toFixed(2), need: 3, examples: [] });
    const e = ringSeen.get(k);
    if (e.examples.length < 3) e.examples.push(describe(el));
  }
  report.focusRingContrastFails = Object.fromEntries(ringSeen);

  mark('rings');
  // heading-word-fit: a word wider than its heading either overflows or, under
  // overflow-wrap: anywhere, splits mid-letter ("BUBBLEGU / M"). Both are invisible to the
  // horizontal-scroll check once wrapping hides them, so measure each word on its own.
  // All probes go in first and are read after, so the page lays out once, not once per word.
  const heads = [];
  for (const h of document.querySelectorAll('h1, h2, h3')) {
    if (!isVisible(h) || h.closest('[aria-hidden="true"]')) continue;
    // an inline heading has no width of its own: the line it sits in is the limit
    let box = h;
    while (box && cs(box).display.startsWith('inline')) box = box.parentElement;
    heads.push({ h, width: box ? box.clientWidth : vw });
  }
  const probes = [];
  for (const { h, width } of heads)
    for (const node of [h, ...h.querySelectorAll('*')]) {
      const text = [...node.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim();
      if (!text) continue;
      for (const word of text.split(/\s+/)) {
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;overflow-wrap:normal';
        probe.textContent = word;
        node.appendChild(probe);
        probes.push({ probe, h, word, width });
      }
    }
  report.headingWordTooWide = [];
  for (const p of probes) {
    const w = p.probe.getBoundingClientRect().width;
    if (w > p.width + 0.5 && report.headingWordTooWide.length < LIMIT) report.headingWordTooWide.push(`${p.h.tagName.toLowerCase()} "${p.word}" ${Math.round(w)}px in ${p.width}px`);
  }
  for (const p of probes) p.probe.remove();

  mark('headingWords');
  // sticky-fit: a sticky block taller than the room under its offset hides its own bottom
  // for the whole scroll (200% zoom, landscape phones). Full-width top bars are the header.
  report.stickyTooTall = everything
    .filter((el) => cs(el).position === 'sticky' && isVisible(el) && el.getBoundingClientRect().width < vw * 0.9)
    .map((el) => ({ el, hidden: Math.round((parseFloat(cs(el).top) || 0) + el.getBoundingClientRect().height - vh) }))
    .filter((x) => x.hidden > 0)
    .slice(0, LIMIT)
    .map((x) => `${describe(x.el)} bottom ${x.hidden}px below the window`);

  // overlay-fit: menus that open from a sticky/fixed header cannot be scrolled into view,
  // so a panel taller than the window must scroll itself. Closed <details> are opened for a
  // moment: `name` is lifted so an exclusive group does not close its open member, and the
  // resulting toggle events are swallowed, so page scripts see nothing.
  report.overlayTooTall = [];
  const toggled = new Set();
  const swallow = (e) => {
    if (!toggled.has(e.target)) return;
    e.stopImmediatePropagation();
    toggled.delete(e.target);
    if (!toggled.size) window.removeEventListener('toggle', swallow, true);
  };
  for (const d of document.querySelectorAll('details')) {
    if (!d.closest('header, nav') || !isVisible(d.querySelector('summary') || d)) continue;
    const wasOpen = d.open;
    const name = d.getAttribute('name');
    if (!wasOpen) {
      if (!toggled.size) window.addEventListener('toggle', swallow, true);
      toggled.add(d);
      if (name !== null) d.removeAttribute('name');
      d.open = true;
    }
    for (const panel of d.querySelectorAll(':scope > :not(summary)')) {
      const r = panel.getBoundingClientRect();
      const s = getComputedStyle(panel);
      const scrolls = /(auto|scroll)/.test(s.overflowY) && panel.scrollHeight > panel.clientHeight;
      if (r.bottom > vh + 1 && !scrolls) report.overlayTooTall.push(`${describe(panel)} bottom ${Math.round(r.bottom - vh)}px below the window, no own scroll`);
    }
    if (!wasOpen) {
      d.open = false;
      if (name !== null) d.setAttribute('name', name);
    }
  }
  report.overlayTooTall = report.overlayTooTall.slice(0, LIMIT);

  mark('overlays');
  // color-scheme-per-theme: scrollbars and form controls follow color-scheme, the mobile
  // browser bar follows theme-color; both should match the page background (the first of
  // html and body that paints one, else the white canvas).
  const rootBg = [document.documentElement, document.body].map((el) => el && parse(cs(el).backgroundColor)).find((c) => c && c.a > 0);
  const pageBg = rootBg ? blend(rootBg, WHITE) : WHITE;
  {
    const light = lum(pageBg) > 0.4;
    const scheme = cs(document.documentElement).colorScheme;
    report.colorScheme = { pageBg: hex(pageBg), colorScheme: scheme, mismatch: (light && /^dark/.test(scheme)) || (!light && /^light/.test(scheme)) };
    const meta = document.querySelector('meta[name="theme-color"]:not([media])');
    const tc = meta && parse(meta.content);
    if (tc) report.colorScheme.themeColor = { value: meta.content, differsFromBg: ratio(tc, pageBg) > 1.5 };
  }

  mark('scheme');
  // ---- consistency: brand-consistency, palette-near-duplicates, palette-size, canon-drift,
  // canon-coverage, font-scale, elevation-consistent, spacing-scale. Unique computed values
  // with their frequency; colours closer than ΔE2000 3 and lengths within 1px are one value.
  // The canon is window.__canonTokens ({name: colour}, nested design tokens with $value, or a
  // list), else the colour custom properties of :root. Same maths as scripts/color-delta.mjs.
  const toLab = ({ r, g, b }) => {
    const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const R = lin(r), G = lin(g), B = lin(b);
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
    const fx = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047), fy = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B), fz = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  };
  const dE = (p, q) => {
    const rad = Math.PI / 180;
    const C1 = Math.hypot(p.a, p.b), C2 = Math.hypot(q.a, q.b);
    const Cm7 = ((C1 + C2) / 2) ** 7;
    const G = 0.5 * (1 - Math.sqrt(Cm7 / (Cm7 + 25 ** 7)));
    const a1 = (1 + G) * p.a, a2 = (1 + G) * q.a;
    const c1 = Math.hypot(a1, p.b), c2 = Math.hypot(a2, q.b);
    const hue = (b, a) => (b === 0 && a === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
    const h1 = hue(p.b, a1), h2 = hue(q.b, a2);
    let dh = 0;
    if (c1 * c2) dh = h2 - h1 > 180 ? h2 - h1 - 360 : h2 - h1 < -180 ? h2 - h1 + 360 : h2 - h1;
    const dL = q.L - p.L, dC = c2 - c1, dH = 2 * Math.sqrt(c1 * c2) * Math.sin((dh / 2) * rad);
    const Lm = (p.L + q.L) / 2, cm = (c1 + c2) / 2;
    let hm = h1 + h2;
    if (c1 * c2) hm = Math.abs(h1 - h2) > 180 ? (hm < 360 ? hm + 360 : hm - 360) / 2 : hm / 2;
    const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
    const Rc = 2 * Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7));
    const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2), SC = 1 + 0.045 * cm, SH = 1 + 0.015 * cm * T;
    const RT = -Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad) * Rc;
    return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
  };
  const mergeNear = (items, near) => {
    const groups = [];
    for (const it of [...items].sort((a, b) => b.count - a.count)) {
      const g = groups.find((x) => near(x.members[0], it));
      if (g) (g.members.push(it), (g.count += it.count));
      else groups.push({ key: it.key, count: it.count, members: [it] });
    }
    return groups.sort((a, b) => b.count - a.count);
  };
  {
    const tally = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    const colorUse = new Map(), fontSizes = new Map(), radii = new Map(), shadows = new Map(), spacing = new Map();
    const textSet = new Set(textEls);
    const px = (v) => Math.round(parseFloat(v) * 2) / 2;
    for (const el of everything) {
      if (!isVisible(el) || srOnly(el)) continue;
      const s = cs(el);
      const own = new Set();
      const take = (v) => {
        const c = parse(v);
        if (c && c.a > 0) own.add(hex(c.a < 1 ? blend(c, pageBg) : c));
      };
      if (textSet.has(el)) (take(s.color), tally(fontSizes, px(s.fontSize)));
      take(s.backgroundColor);
      let border = false;
      for (const side of ['Top', 'Right', 'Bottom', 'Left'])
        if (parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== 'none') (take(s[`border${side}Color`]), (border = true));
      for (const c of own) tally(colorUse, c);
      const paints = border || s.boxShadow !== 'none' || (parse(s.backgroundColor)?.a || 0) > 0 || s.backgroundImage !== 'none' || /^(IMG|VIDEO|CANVAS|PICTURE)$/.test(el.tagName);
      if (paints)
        for (const v of new Set([s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius])) if (v && !/^0px/.test(v)) tally(radii, /%/.test(v) ? v : px(v));
      if (s.boxShadow !== 'none') tally(shadows, s.boxShadow);
      for (const v of [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft, s.marginTop, s.marginBottom]) if (parseFloat(v) > 0) tally(spacing, px(v));
      if (/flex|grid/.test(s.display)) for (const v of [s.rowGap, s.columnGap]) if (parseFloat(v) > 0) tally(spacing, px(v));
    }
    const lengths = (m, unit = 'px') =>
      mergeNear(
        [...m].map(([key, count]) => ({ key, count })),
        (a, b) => typeof a.key === 'number' && typeof b.key === 'number' && Math.abs(a.key - b.key) <= 1,
      ).map((g) => `${g.key}${typeof g.key === 'number' ? unit : ''} ×${g.count}${g.members.length > 1 ? ` (+${g.members.slice(1).map((x) => x.key).join(', ')})` : ''}`);
    const colors = [...colorUse].map(([key, count]) => {
      const rgb = parse(key);
      return { key, count, lab: toLab(rgb) };
    });
    const merged = mergeNear(colors, (a, b) => dE(a.lab, b.lab) < 3);
    const accents = merged.filter((g) => Math.hypot(g.members[0].lab.a, g.members[0].lab.b) >= 15);
    const fs = lengths(fontSizes);
    const spacingGroups = mergeNear([...spacing].map(([key, count]) => ({ key, count })), (a, b) => Math.abs(a.key - b.key) <= 1);
    const c = (report.consistency = {
      colors: { distinct: colors.length, afterMerge: merged.length, top: merged.slice(0, LIMIT).map((g) => `${g.key} ×${g.count}`) },
      // palette-near-duplicates: the most used value of a group first, the near ones after it
      nearDuplicates: merged.filter((g) => g.members.length > 1).slice(0, LIMIT).map((g) => `${g.key} ×${g.members[0].count} ~ ${g.members.slice(1).map((m) => `${m.key} ×${m.count} ΔE ${dE(g.members[0].lab, m.lab).toFixed(1)}`).join(', ')}`),
      // palette-size: colours with Lab chroma ≥ 15 after merging (greys and near-greys are neutrals)
      accents: accents.map((g) => `${g.key} ×${g.count}`),
      fontSizes: fs,
      radii: lengths(radii),
      shadows: [...shadows].sort((a, b) => b[1] - a[1]).slice(0, LIMIT).map(([v, n]) => `${v} ×${n}`),
      spacing: spacingGroups.slice(0, LIMIT * 2).map((g) => `${g.key}px ×${g.count}`),
      spacingOffGrid: spacingGroups.filter((g) => g.key % 4 && g.key > 2).slice(0, LIMIT).map((g) => `${g.key}px ×${g.count}`),
      counts: { fontSizes: fs.length, radii: radii.size, shadows: shadows.size, spacing: spacingGroups.length },
    });
    // canon: given tokens, else the page's own :root colour tokens
    const flat = (v, name = '', out = []) => {
      if (typeof v === 'string') out.push([name || v, v]);
      else if (Array.isArray(v)) v.forEach((x, i) => flat(x, name ? `${name}.${i}` : '', out));
      else if (v && typeof v === 'object') {
        const leaf = v.$value ?? v.value;
        if (typeof leaf === 'string') out.push([name, leaf]);
        else for (const [k, x] of Object.entries(v)) if (!k.startsWith('$')) flat(x, name ? `${name}.${k}` : k, out);
      }
      return out;
    };
    let source = 'window.__canonTokens';
    let entries = window.__canonTokens ? flat(window.__canonTokens) : [];
    if (!window.__canonTokens) {
      source = ':root custom properties';
      const names = new Set();
      for (const r of styleRules) if (r.scope === document && !r.media.length && /^\s*(:root|html)\s*$/i.test(r.sel)) for (let i = 0; i < r.style.length; i++) if (r.style[i].startsWith('--')) names.add(r.style[i]);
      const rootStyle = getComputedStyle(document.documentElement);
      entries = [...names].map((n) => [n, rootStyle.getPropertyValue(n).trim()]);
    }
    const canon = entries
      .map(([name, v]) => {
        const k = /^-?[\d.]+(px|rem|em|%)?$|^\s*$/.test(v) ? null : parse(v); // "0", "16px" are not colours
        return k && k.a > 0 ? { name, hex: hex(k.a < 1 ? blend(k, pageBg) : k), lab: toLab(k.a < 1 ? blend(k, pageBg) : k) } : null;
      })
      .filter(Boolean);
    if (canon.length) {
      const nearest = (lab) => canon.reduce((best, t) => ((t.d = dE(lab, t.lab)), !best || t.d < best.d ? { ...t } : best), null);
      let total = 0, off = 0;
      const drift = [];
      for (const g of merged)
        for (const m of g.members) {
          total += m.count;
          const n = nearest(m.lab);
          if (n.d > 5) (off += m.count, drift.push({ m, n }));
        }
      drift.sort((a, b) => b.m.count - a.m.count);
      c.canon = {
        source,
        colorTokens: canon.length,
        // canon-drift: used colours further than ΔE 5 from every canon colour; ΔE > 20 is a foreign colour
        drift: drift.slice(0, LIMIT).map(({ m, n }) => `${m.key} ×${m.count}: nearest ${n.name} ${n.hex} ΔE ${n.d.toFixed(1)}`),
        maxDrift: drift.length ? +Math.max(...drift.map((x) => x.n.d)).toFixed(1) : 0,
        offCanonShare: total ? +(off / total).toFixed(2) : 0,
        // canon-coverage: canon colours nothing on this page uses (ΔE < 1)
        unused: canon.filter((t) => !colors.some((x) => dE(x.lab, t.lab) < 1)).slice(0, LIMIT * 2).map((t) => `${t.name} ${t.hex}`),
      };
    } else c.canon = { source, colorTokens: 0 };
  }

  mark('consistency');

  // hover-media and motion timing: hover that moves or scales sticks after a tap on touch
  // screens unless it sits under @media (hover: hover) (or the boolean form (hover));
  // hover responses should share one timing.
  const HOVER_MEDIA = /\(\s*(any-)?hover\s*(\)|:\s*hover)/;
  const hoverMoves = [];
  const durations = new Set();
  for (const r of styleRules) {
    const s = r.style;
    if (s.transitionDuration)
      for (const d of s.transitionDuration.split(',')) {
        const ms = /ms$/.test(d.trim()) ? parseFloat(d) : parseFloat(d) * 1000;
        if (ms > 0) durations.add(ms);
      }
    if (/:hover\b/.test(r.sel) && !r.media.some((m) => HOVER_MEDIA.test(m)) && (s.transform || s.translate || s.scale || s.rotate)) hoverMoves.push(r.sel);
  }
  report.hoverMotionOutsideHoverMedia = [...new Set(hoverMoves)].slice(0, LIMIT);
  report.transitionDurations = [...durations].sort((a, b) => a - b).map((ms) => `${ms}ms`);

  mark('hover');
  // images: oversized, missing dimensions, lazy above the fold
  const dpr = window.devicePixelRatio || 1;
  report.images = [...document.images]
    .filter(isVisible)
    .map((img) => {
      const r = img.getBoundingClientRect();
      const issues = [];
      if (img.naturalWidth > r.width * dpr * 2.2 && img.naturalWidth > 400) issues.push(`oversized ${img.naturalWidth}px for ${Math.round(r.width)}px slot`);
      if (!img.getAttribute('width') || !img.getAttribute('height')) issues.push('no width/height');
      if (img.loading === 'lazy' && r.top < vh && window.scrollY === 0) issues.push('lazy above the fold');
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

  // text truncation / clipping (overflow hidden or clip on either axis, or an ellipsis)
  report.clippedText = textEls
    .filter((el) => {
      const s = cs(el);
      const clips = /^(hidden|clip)$/.test(s.overflowX) || /^(hidden|clip)$/.test(s.overflowY) || s.textOverflow === 'ellipsis';
      return clips && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
    })
    .slice(0, LIMIT)
    .map(describe);

  mark('page');
  // ---- motion: motion-element-cap, motion-consistency, motion-spatial-linear, motion-stagger-budget
  const toMs = (d) => (/ms$/.test(d.trim()) ? parseFloat(d) : parseFloat(d) * 1000) || 0;
  const list = (v) => (v || '').split(/,(?![^(]*\))/).map((x) => x.trim());
  const pairs = new Map(); // "200ms ease-out" -> rules using it
  const linearSpatial = [];
  const spatialKeyframes = new Set();
  const visitKeyframes = (rules) => {
    for (const r of rules) {
      if (r.type === 7 /* @keyframes */ && [...r.cssRules].some((k) => k.style.transform || k.style.translate || k.style.scale)) spatialKeyframes.add(r.name);
      else if (r.cssRules && r.type !== 7) visitKeyframes(r.cssRules);
    }
  };
  for (const scope of [document, ...shadowRoots]) for (const sheet of sheetsOf(scope)) try { visitKeyframes(sheet.cssRules); } catch {}
  for (const r of styleRules) {
    const s = r.style;
    const props = list(s.transitionProperty), tdur = list(s.transitionDuration), tease = list(s.transitionTimingFunction);
    if (s.transitionDuration)
      tdur.forEach((d, i) => {
        if (!toMs(d)) return;
        const ease = tease[i % tease.length] || 'ease';
        pairs.set(`${toMs(d)}ms ${ease}`, (pairs.get(`${toMs(d)}ms ${ease}`) || 0) + 1);
        const p = props[i % props.length] || 'all';
        if (ease === 'linear' && /^(all|transform|translate|scale)$/.test(p)) linearSpatial.push(`${r.sel}: transition ${p} linear`);
      });
    if (s.animationName && s.animationName !== 'none') {
      const names = list(s.animationName), adur = list(s.animationDuration), aease = list(s.animationTimingFunction), iter = list(s.animationIterationCount);
      names.forEach((n, i) => {
        const d = toMs(adur[i % adur.length] || '0s');
        const ease = aease[i % aease.length] || 'ease';
        if (d) pairs.set(`${d}ms ${ease}`, (pairs.get(`${d}ms ${ease}`) || 0) + 1);
        // spinners and progress loop forever on purpose: only finite spatial animations count
        if (ease === 'linear' && spatialKeyframes.has(n) && iter[i % iter.length] !== 'infinite') linearSpatial.push(`${r.sel}: animation ${n} linear`);
      });
    }
  }
  const anims = document.getAnimations ? document.getAnimations() : [];
  const inView = anims.filter((a) => {
    const t = a.effect && a.effect.target;
    if (!t || a.playState !== 'running') return false;
    const r = t.getBoundingClientRect();
    return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  });
  // stagger: siblings whose delays step up; the whole cascade should end within 500 ms, 20–100 ms a step
  const byParent = new Map();
  for (const el of everything) {
    const s = cs(el);
    const animated = s.animationName !== 'none' || (s.transitionProperty !== 'none' && toMs(list(s.transitionDuration)[0]) > 0);
    const d = Math.max(s.animationName !== 'none' ? toMs(list(s.animationDelay)[0]) : 0, toMs(list(s.transitionDelay)[0]));
    if (animated && el.parentElement) {
      if (!byParent.has(el.parentElement)) byParent.set(el.parentElement, []);
      byParent.get(el.parentElement).push(d);
    }
  }
  const staggers = [];
  const judge = (where, delays) => {
    const ds = [...new Set(delays)].sort((a, b) => a - b);
    if (ds.length < 3) return;
    const steps = ds.slice(1).map((d, i) => d - ds[i]);
    const step = steps.sort((a, b) => a - b)[Math.floor(steps.length / 2)];
    const total = ds[ds.length - 1] - ds[0]; // from the first item's start to the last one's
    if (total > 500 || step < 20 || step > 100) staggers.push(`${where}: ${ds.length} steps of ≈${Math.round(step)}ms, cascade ${Math.round(total)}ms`);
  };
  for (const [p, ds] of byParent) judge(describe(p), ds);
  report.motion = {
    running: anims.filter((a) => a.playState === 'running').length,
    runningInView: inView.length, // motion-element-cap: about 20 at once is the ceiling
    timingPairs: [...pairs].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).slice(0, LIMIT * 2), // motion-consistency: more than ~6 is noise
    linearSpatial: [...new Set(linearSpatial)].slice(0, LIMIT),
    staggers,
  };

  // ---- GSAP (gsap-* in web.md). Read-only: tweens and triggers are inspected, nothing is played.
  // window.__auditGsapRefresh = true also calls ScrollTrigger.refresh() and reports triggers
  // whose start moved (positions measured before fonts and images settled: gsap-st-refresh).
  const G = window.gsap;
  if (G && G.version) {
    const ST = window.ScrollTrigger || (G.core && G.core.globals && G.core.globals().ScrollTrigger);
    const g = (report.gsap = { version: G.version });
    try {
      const tweens = G.globalTimeline.getChildren(true, true, false);
      g.tweens = tweens.length;
      for (const t of tweens) {
        const st = t.vars && t.vars.stagger;
        if (!st) continue;
        const n = t.targets ? t.targets().length : 0;
        const each = typeof st === 'number' ? st : st.each;
        const total = typeof st === 'object' && st.amount !== undefined ? st.amount : (each || 0) * Math.max(0, n - 1);
        if (n >= 3) judge(`gsap tween on ${n} targets`, Array.from({ length: n }, (_, i) => Math.round(((total * 1000) / Math.max(1, n - 1)) * i)));
      }
    } catch {}
    if (ST && ST.getAll) {
      const all = ST.getAll();
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      g.scrollTriggers = all.length;
      g.reducedMotionEmulated = reduce; // gsap-reduced-motion: with reduce on, the count should be 0
      g.markers = all.filter((s) => s.vars && s.vars.markers).length + document.querySelectorAll('.gsap-marker-start, .gsap-marker-scroller-start').length; // gsap-st-markers
      g.misuse = all
        .flatMap((s) => {
          const v = s.vars || {};
          const out = [];
          if (v.scrub && v.toggleActions) out.push('scrub with toggleActions: toggleActions is ignored');
          if (v.containerAnimation && s.animation && s.animation.vars && s.animation.vars.ease && s.animation.vars.ease !== 'none') out.push('containerAnimation with an ease other than "none"');
          const pin = s.pin;
          if (pin && s.animation && s.animation.targets && s.animation.targets().includes(pin)) out.push(`the pinned element itself is animated: ${describe(pin)}`);
          return out;
        })
        .slice(0, LIMIT);
      if (window.__auditGsapRefresh && all.length) {
        const before = all.map((s) => s.start);
        ST.refresh();
        g.startMovedAfterRefresh = all.filter((s, i) => Math.abs(s.start - before[i]) > 2).length;
      }
    }
  }

  // ---- Lottie players: lottie-reduced-motion, media-autoplay-controls. Web components
  // (lottie-player, dotlottie-player, dotlottie-wc) and lottie-web's registered animations.
  {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const found = [];
    for (const el of document.querySelectorAll('lottie-player, dotlottie-player, dotlottie-wc')) {
      if (!isVisible(el)) continue;
      const on = (a) => el.hasAttribute(a) && el.getAttribute(a) !== 'false';
      const notes = [on('autoplay') ? 'autoplay' : '', on('loop') ? 'loop' : '', on('controls') ? 'controls' : 'no controls'].filter(Boolean);
      if (on('autoplay') && on('loop') && !on('controls')) notes.push('loops with no pause control (media-autoplay-controls)');
      if (reduce && on('autoplay')) notes.push('autoplays under reduced motion (lottie-reduced-motion)');
      found.push(`${describe(el)}: ${notes.join(', ')}`);
    }
    const lw = window.lottie || window.bodymovin;
    if (lw && lw.getRegisteredAnimations)
      for (const a of lw.getRegisteredAnimations()) {
        const box = a.wrapper;
        if (box && !isVisible(box)) continue;
        const notes = [a.isPaused ? 'paused' : 'playing', a.loop ? 'loop' : 'once'];
        if (reduce && !a.isPaused) notes.push('plays under reduced motion (lottie-reduced-motion)');
        found.push(`lottie-web ${box ? describe(box) : a.name || 'animation'}: ${notes.join(', ')}`);
      }
    if (found.length) report.lottie = { reducedMotionEmulated: reduce, players: found.slice(0, LIMIT) };
  }

  // ---- canvas and WebGL: gl-pixel-ratio, canvas-name
  const canvases = [...document.querySelectorAll('canvas')].filter(isVisible);
  if (canvases.length) {
    report.canvas = canvases.slice(0, LIMIT).map((cv) => {
      const r = cv.getBoundingClientRect();
      const ratio = r.width ? cv.width / r.width : 0;
      const named = cv.getAttribute('aria-hidden') === 'true' || !!(cv.getAttribute('aria-label') || cv.getAttribute('aria-labelledby') || cv.textContent.trim() || cv.querySelector('*'));
      const issues = [];
      if (ratio > 2.05) issues.push(`backing store ${cv.width}px for ${Math.round(r.width)}px: pixel ratio ${ratio.toFixed(1)} > 2 (gl-pixel-ratio)`);
      if (!named) issues.push('no name, no fallback content and not aria-hidden (canvas-name)');
      return `${describe(cv)} ${Math.round(r.width)}x${Math.round(r.height)}${issues.length ? ': ' + issues.join('; ') : ''}`;
    });
  }

  // notApplicable: checks that had nothing to look at on this page and width. They are not
  // passes: «не применимо» goes to its own line of the report, never to «в порядке».
  const na = {};
  if (!textEls.length) na.contrast = na.tinyText = 'no visible text';
  if (!interactive.length) na.targetsUnder24 = na.focusIndicatorMissing = na.focusRingContrastFails = 'no interactive elements';
  if (vw >= 768) na.targetsUnder44OnMobile = na.bodyTextUnder16OnMobile = `width ${vw}px: mobile checks run below 768px`;
  if (!stickies.length) na.stickyHeader = 'no sticky or fixed header';
  if (!everything.some((el) => cs(el).position === 'sticky')) na.stickyTooTall = 'no position: sticky';
  if (!document.querySelector('header details, nav details')) {
    na.overlayTooTall = 'no <details> menu in header or nav';
    notMeasured.jsMenus = document.querySelectorAll('header [aria-expanded], nav [aria-expanded]').length; // menus opened by script: open them by hand
  }
  if (!heads.length) na.headingWordTooWide = 'no visible h1–h3';
  if (![...document.images].some(isVisible)) na.images = 'no visible images';
  if (!document.querySelector('nav')) na.navCurrent = 'no nav';
  if (!report.motion.running && !pairs.size) na.motion = 'no CSS transitions or animations and nothing running';
  if (!report.gsap) na.gsap = 'no GSAP on the page (window.gsap)';
  if (!canvases.length) na.canvas = 'no visible <canvas>';
  if (!report.lottie) na.lottie = 'no Lottie player (lottie-player, dotlottie-*, lottie-web)';
  if (!report.consistency.canon.colorTokens) na['consistency.canon'] = 'no canon: no window.__canonTokens and no colour tokens on :root';
  report.notApplicable = na;
  for (const k of Object.keys(notMeasured)) if (!notMeasured[k]) delete notMeasured[k];
  mark('total');
  if (timings) report.timings = timings;
  report.notMeasured = notMeasured; // gradientText, overImage, unparsedColor: text elements; iframes: not entered
  return report;
})()
