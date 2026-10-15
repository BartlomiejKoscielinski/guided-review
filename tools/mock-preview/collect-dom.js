// Browser-side collector shared by render-mock.mjs (--styles) and tests/e2e/design-shots.spec.ts.
// Evaluated as an expression with page.evaluate(source): returns one entry per element that has
// its own visible text, with the computed styles /design-check compares (compare-dom.mjs).
(() => {
  const out = [];
  const px = (v) => Math.round(parseFloat(v) * 10) / 10;
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('script,style,svg')) continue;
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    if (!own.trim() && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) own = el.value || el.placeholder || '';
    const t = own.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
    out.push({
      t: t.slice(0, 80),
      x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      ff: s.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      fs: px(s.fontSize), fw: s.fontWeight, tt: s.textTransform, ls: s.letterSpacing, lh: s.lineHeight,
      c: s.color,
      bg: s.backgroundColor === 'rgba(0, 0, 0, 0)' ? '' : s.backgroundColor,
      br: s.borderRadius === '0px' ? '' : s.borderRadius,
    });
  }
  return out;
})()
