// HTML slide deck checks. Evaluate this whole file as one expression in the page with the deck
// (reveal.js, artifact decks, own markup). Returns a JSON-serializable report.
// Rules: slides.md (slide-text-overflow, slide-overlap, slide-margins, slide-type-scale).
// Slides are found by window.__slideSelector if set, else by common markup; a slide must be
// at least 300px wide. Font sizes are converted to points of a 13.33×7.5 in slide, the size
// PowerPoint and Keynote use for 16:9, so the thresholds match slides.md.
(() => {
  const LIMIT = 30;
  const selector = window.__slideSelector || '.reveal .slides > section, section.slide, .slide, [data-slide], .deck > section';
  const slides = [...document.querySelectorAll(selector)].filter((s) => s.getBoundingClientRect().width >= 300 && !s.parentElement.closest(selector));
  const describe = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    return `${el.tagName.toLowerCase()}${cls} "${(el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 36)}"`;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0;
  };
  const report = { slides: slides.length, selector, issues: [] };
  const add = (level, rule, slide, msg) => report.issues.length < LIMIT * 4 && report.issues.push({ level, rule, slide, msg });
  if (!slides.length) {
    report.note = 'no slides found: set window.__slideSelector = "<css selector of one slide>" and run again';
    return report;
  }
  const sizes = new Set();
  slides.forEach((slide, i) => {
    const n = i + 1;
    const S = slide.getBoundingClientRect();
    const toPt = (px) => (px * 540) / S.height; // 7.5 in = 540 pt
    // leaf text blocks: elements that own visible text
    const blocks = [...slide.querySelectorAll('*')].filter((el) => visible(el) && [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
    for (const el of blocks) {
      const r = el.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(el).fontSize);
      const pt = Math.round(toPt(fs));
      sizes.add(pt);
      if (r.right > S.right + 1 || r.bottom > S.bottom + 1 || r.left < S.left - 1 || r.top < S.top - 1) add('FAIL', 'slide-text-overflow', n, `${describe(el)} runs past the slide edge`);
      if (el.scrollHeight > el.clientHeight + 2 && /(hidden|clip)/.test(getComputedStyle(el).overflowY)) add('FAIL', 'slide-text-overflow', n, `${describe(el)} is clipped by its own box`);
      for (let p = el.parentElement; p && p !== slide; p = p.parentElement)
        if (/(hidden|clip)/.test(getComputedStyle(p).overflow) && p.scrollHeight > p.clientHeight + 2 && r.bottom > p.getBoundingClientRect().bottom + 1) {
          add('FAIL', 'slide-text-overflow', n, `${describe(el)} is clipped by ${describe(p)}`);
          break;
        }
      const m = Math.min(r.left - S.left, r.top - S.top, S.right - r.right, S.bottom - r.bottom);
      if (m < S.width * 0.04 && m > -1) add('WARN', 'slide-margins', n, `${describe(el)} ${Math.round(m)}px from the edge (< 4% of the slide width)`);
      if (pt < 18) add(pt < 10 ? 'FAIL' : pt < 12 ? 'WARN' : 'INFO', 'slide-type-scale', n, `${describe(el)} at ≈${pt} pt (≥ 18 pt to project, ≥ 12 pt as PDF)`);
    }
    // overlaps between text blocks that are not nested in each other
    for (let a = 0; a < blocks.length; a++)
      for (let b = a + 1; b < blocks.length; b++) {
        const A = blocks[a], B = blocks[b];
        if (A.contains(B) || B.contains(A)) continue;
        const r1 = A.getBoundingClientRect(), r2 = B.getBoundingClientRect();
        const ix = Math.max(0, Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left));
        const iy = Math.max(0, Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top));
        if (ix * iy > 0.04 * Math.min(r1.width * r1.height, r2.width * r2.height)) add('WARN', 'slide-overlap', n, `${describe(A)} overlaps ${describe(B)}`);
      }
    const slideSizes = new Set(blocks.map((el) => Math.round(toPt(parseFloat(getComputedStyle(el).fontSize)))));
    if (slideSizes.size > 4) add('INFO', 'slide-type-scale', n, `${slideSizes.size} different text sizes on one slide`);
  });
  report.textSizesPt = [...sizes].sort((a, b) => a - b);
  return report;
})();
