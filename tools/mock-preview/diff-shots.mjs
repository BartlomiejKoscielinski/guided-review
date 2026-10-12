#!/usr/bin/env node
// Compares a design PNG with an implementation PNG without opening either image in full.
// Prints a text heatmap (mean pixel difference per grid cell, 0-99) and writes side-by-side
// crops (design left, implementation right) of the most different cells or of given regions.
// Used by the /design-check skill: read the heatmap first, then open only the crops you need.
//
// Usage:
//   node tools/mock-preview/diff-shots.mjs <design.png> <impl.png> [--grid 8x5] [--top 4]
//        [--region x,y,w,h ...] [--out-prefix .design-check/cmp-S06-local]
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const args = process.argv.slice(2);
const [designPath, implPath] = args;
if (!designPath || !implPath) {
  console.error('Usage: diff-shots.mjs <design.png> <impl.png> [--grid 8x5] [--top 4] [--region x,y,w,h]');
  process.exit(2);
}
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const [cols, rows] = opt('grid', '8x5').split('x').map(Number);
const top = Number(opt('top', 4));
const regions = args.flatMap((a, i) => (a === '--region' ? [args[i + 1].split(',').map(Number)] : []));
const prefix = resolve(opt('out-prefix', '.design-check/cmp'));
mkdirSync(dirname(prefix), { recursive: true });

const dataUrl = (p) => 'data:image/png;base64,' + readFileSync(resolve(p)).toString('base64');

const browser = await chromium.launch();
const page = await browser.newPage();
const result = await page.evaluate(
  async ({ a, b, cols, rows, top, regions }) => {
    const load = (src) =>
      new Promise((ok, fail) => {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = fail;
        img.src = src;
      });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = Math.min(ia.width, ib.width);
    const h = Math.min(ia.height, ib.height);
    const pixels = (img) => {
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, w, h).data;
    };
    const pa = pixels(ia);
    const pb = pixels(ib);
    const cw = Math.floor(w / cols);
    const ch = Math.floor(h / rows);
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        for (let y = r * ch; y < (r + 1) * ch; y += 2) {
          for (let x = c * cw; x < (c + 1) * cw; x += 2) {
            const i = (y * w + x) * 4;
            sum += Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]);
          }
        }
        const score = Math.min(99, Math.round((sum / ((cw * ch) / 4) / 765) * 400));
        cells.push({ r, c, score, rect: [c * cw, r * ch, cw, ch] });
      }
    }
    const picked = regions.length
      ? regions
      : [...cells]
          .sort((x, y) => y.score - x.score)
          .filter((x) => x.score > 0)
          .slice(0, top)
          .map((x) => x.rect);
    const crops = picked.map(([x, y, cw2, ch2]) => {
      const c = new OffscreenCanvas(cw2 * 2 + 8, ch2);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(ia, x, y, cw2, ch2, 0, 0, cw2, ch2);
      ctx.drawImage(ib, x, y, cw2, ch2, cw2 + 8, 0, cw2, ch2);
      return { rect: [x, y, cw2, ch2], canvas: c };
    });
    const encoded = [];
    for (const { rect, canvas } of crops) {
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      encoded.push({ rect, png: btoa(bin) });
    }
    return { w, h, sizes: [ia.width, ia.height, ib.width, ib.height], cw, ch, cells, encoded };
  },
  { a: dataUrl(designPath), b: dataUrl(implPath), cols, rows, top, regions },
);
await browser.close();

const [aw, ah, bw, bh] = result.sizes;
if (aw !== bw || ah !== bh) console.log(`size differs: design ${aw}×${ah}, impl ${bw}×${bh}`);
console.log(`diff per cell (0 = identical, 99 = very different), cell ${result.cw}×${result.ch}px`);
console.log('     ' + Array.from({ length: cols }, (_, c) => String(c * result.cw).padStart(5)).join(''));
for (let r = 0; r < rows; r++) {
  const line = result.cells.filter((x) => x.r === r).map((x) => String(x.score).padStart(5));
  console.log(String(r * result.ch).padStart(5) + line.join(''));
}
result.encoded.forEach(({ rect, png }, i) => {
  const file = `${prefix}-${i + 1}.png`;
  writeFileSync(file, Buffer.from(png, 'base64'));
  console.log(`crop ${i + 1}: x,y,w,h=${rect.join(',')} → ${file} (design | impl)`);
});
