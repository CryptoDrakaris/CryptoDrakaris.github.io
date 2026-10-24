(() => {
  // HTML slide deck checks. The whole file is one expression: evaluate it as is, wrapped in
  // parentheses or after `return`, in the page with the deck (reveal.js, artifact decks, own
  // markup). Returns a JSON-serializable report.
  // Rules: slides.md (slide-text-overflow, slide-overlap, slide-margins, slide-type-scale).
  // Slides are found by window.__slideSelector if set, else by common markup: the outermost
  // matches at least 300px wide and shaped like a slide (4:3 to 16:9, give or take). Slides
  // hidden with display:none (reveal.js shows one at a time) are listed, not measured.
  // Font sizes are converted to points of a 13.33×7.5 in slide, the size PowerPoint and
  // Keynote use for 16:9, so the thresholds match slides.md. The slide's own layout height is
  // the reference, so a deck scaled down to fit the window still reports its design sizes.
  // window.__slideLimit caps the number of issues (default 120). notApplicable names the checks
  // that had nothing to look at (no pictures, no text): they are not passes.
  // A deck where no slide is found is not measured at all (see note), not «fine».
  const LIMIT = window.__slideLimit || 120;
  const custom = !!window.__slideSelector;
  const selector = window.__slideSelector || '.reveal .slides > section, section.slide, .slide, [data-slide], .deck > section';
  const all = [...document.querySelectorAll(selector)].filter((s) => !s.parentElement || !s.parentElement.closest(selector));
  const describe = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    return `${el.tagName.toLowerCase()}${cls} "${(el.innerText || el.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 36)}"`;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0;
  };
  const slideLike = (s) => {
    if (custom) return true;
    const ar = s.offsetWidth / Math.max(1, s.offsetHeight);
    return ar >= 1.2 && ar <= 2.1;
  };
  const shown = all.filter((s) => s.getBoundingClientRect().width >= 300 && getComputedStyle(s).display !== 'none');
  const slides = shown.filter(slideLike);
  const report = { slides: slides.length, selector, issues: [] };
  const hidden = all.map((s, i) => [s, i + 1]).filter(([s]) => getComputedStyle(s).display === 'none').map(([, n]) => n);
  if (hidden.length) report.hiddenSlides = { numbers: hidden, note: 'display:none slides are not measured: show them (or step through the deck) and run again' };
  if (shown.length > slides.length) report.skippedNotSlideShaped = shown.filter((s) => !slideLike(s)).map(describe).slice(0, 10);
  let dropped = 0;
  const add = (level, rule, slide, msg) => (report.issues.length < LIMIT ? report.issues.push({ level, rule, slide, msg }) : dropped++);
  if (!slides.length) {
    report.note = 'no slides found: set window.__slideSelector = "<css selector of one slide>" and run again';
    return report;
  }
  // the box of an element's own text, not of its block (a centred line in a full-width box)
  const textRect = (el) => {
    let box = null;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      box = box ? { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top), right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
    return box && { ...box, width: box.right - box.left, height: box.bottom - box.top };
  };
  const overlap = (r1, r2) => {
    const ix = Math.max(0, Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left));
    const iy = Math.max(0, Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top));
    return ix * iy > 0.04 * Math.min(r1.width * r1.height, r2.width * r2.height);
  };
  const sizes = new Set();
  let mediaSeen = 0, textSeen = 0;
  for (const slide of slides) {
    const n = all.indexOf(slide) + 1;
    const S = slide.getBoundingClientRect();
    const toPt = (px) => (px * 540) / slide.offsetHeight; // 7.5 in = 540 pt; layout px, before transforms
    // leaf text blocks: elements that own visible text
    const blocks = [...slide.querySelectorAll('*')].filter((el) => visible(el) && [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
    const media = [...slide.querySelectorAll('img, svg, video, canvas, picture')].filter((el) => visible(el) && !el.closest('svg svg'));
    const texts = [];
    (mediaSeen += media.length), (textSeen += blocks.length);
    for (const el of blocks) {
      const box = el.getBoundingClientRect();
      const r = textRect(el) || box;
      texts.push({ el, r });
      const fs = parseFloat(getComputedStyle(el).fontSize);
      const pt = Math.round(toPt(fs));
      sizes.add(pt);
      const past = (q) => q.right > S.right + 1 || q.bottom > S.bottom + 1 || q.left < S.left - 1 || q.top < S.top - 1;
      if (past(r)) add('FAIL', 'slide-text-overflow', n, `${describe(el)} runs past the slide edge`);
      else if (past(box)) add('INFO', 'slide-off-canvas', n, `${describe(el)}: its box runs past the slide edge, the text itself fits`);
      if (el.scrollHeight > el.clientHeight + 2 && /(hidden|clip)/.test(getComputedStyle(el).overflowY)) add('FAIL', 'slide-text-overflow', n, `${describe(el)} is clipped by its own box`);
      for (let p = el.parentElement; p && p !== slide; p = p.parentElement)
        if (/(hidden|clip)/.test(getComputedStyle(p).overflow) && p.scrollHeight > p.clientHeight + 2 && box.bottom > p.getBoundingClientRect().bottom + 1) {
          add('FAIL', 'slide-text-overflow', n, `${describe(el)} is clipped by ${describe(p)}`);
          break;
        }
      const m = Math.min(r.left - S.left, r.top - S.top, S.right - r.right, S.bottom - r.bottom);
      if (m < S.width * 0.05 && m > -1) add('WARN', 'slide-margins', n, `${describe(el)} ${Math.round(m)}px from the edge (< 5% of the slide width)`);
      if (pt < 18) add(pt < 10 ? 'FAIL' : pt < 12 ? 'WARN' : 'INFO', 'slide-type-scale', n, `${describe(el)} at ≈${pt} pt (≥ 18 pt to project, ≥ 12 pt as PDF)`);
    }
    // overlaps between text blocks that are not nested in each other, and text over pictures
    for (let a = 0; a < texts.length; a++)
      for (let b = a + 1; b < texts.length; b++) {
        const A = texts[a], B = texts[b];
        if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
        if (overlap(A.r, B.r)) add('WARN', 'slide-overlap', n, `${describe(A.el)} overlaps ${describe(B.el)}`);
      }
    for (const t of texts)
      for (const img of media) {
        if (img.contains(t.el) || t.el.contains(img)) continue;
        if (overlap(t.r, img.getBoundingClientRect())) add('INFO', 'slide-overlap', n, `${describe(t.el)} lies over ${describe(img)}: check contrast on the picture (slide-contrast)`);
      }
    const slideSizes = new Set(blocks.map((el) => Math.round(toPt(parseFloat(getComputedStyle(el).fontSize)))));
    if (slideSizes.size > 4) add('INFO', 'slide-type-scale', n, `${slideSizes.size} different text sizes on one slide`);
  }
  report.notApplicable = {};
  if (!mediaSeen) report.notApplicable['slide-overlap'] = 'no pictures on the slides: text over images does not apply';
  if (!textSeen) report.notApplicable['slide-text-overflow'] = 'no text on the slides (text drawn into pictures is checked by eye)';
  if (dropped) report.droppedIssues = `${dropped} more issue(s) not listed: raise window.__slideLimit`;
  report.textSizesPt = [...sizes].sort((a, b) => a - b);
  return report;
})()
