#!/usr/bin/env node
// Renders a design mock (docs/design/mocks/*.dc.html) to PNG, optionally in a given UI state.
// Used by the /design-check skill to compare the implementation with the design.
//
// Usage:
//   node tools/mock-preview/render-mock.mjs <Mock.dc.html> [--state '<json>'] [--props '<json>']
//        [--width 1600] [--height 1000] [--out path.png] [--text]
//
// Requires dev dependencies: playwright, @fontsource/barlow, @fontsource/barlow-condensed,
// @fontsource/jetbrains-mono. The mock's own runtime is not needed: dc-shim.js expands the
// template ({{holes}}, <sc-for>, <sc-if>) with values from the mock's renderVals().
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const args = process.argv.slice(2);
if (!args[0]) { console.error('Usage: render-mock.mjs <Mock.dc.html> [--state json] [--out file]'); process.exit(2); }
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const mockArg = args[0];
const mockPath = mockArg.includes('/') || mockArg.includes('\\') ? resolve(mockArg) : join(root, 'docs', 'design', 'mocks', mockArg);
const width = Number(opt('width', 1600));
const height = Number(opt('height', 1000));
const state = opt('state', null);
const props = opt('props', null);
const out = resolve(opt('out', join(root, '.design-check', basename(mockPath).replace('.dc.html', '') + '.png')));
const wantText = args.includes('--text');

const shim = readFileSync(join(here, 'dc-shim.js'), 'utf8');
const fontDir = join(root, 'node_modules', '@fontsource');
const fonts = [['barlow', [400, 500, 600, 700]], ['barlow-condensed', [600, 700, 800]], ['jetbrains-mono', [400, 500, 600]]]
  .flatMap(([fam, ws]) => ws.map((w) => `<link rel="stylesheet" href="${pathToFileURL(join(fontDir, fam, w + '.css')).href}">`)).join('');

let html = readFileSync(mockPath, 'utf8');
html = html.replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/g, '');
const pre = (state ? `<script>window.__STATE=${state};</script>` : '') + (props ? `<script>window.__PROPS=${props};</script>` : '');
// Function replacements: the shim contains '$' sequences that string replacements would interpret.
html = html.replace('<script src="./support.js"></script>', () => pre + '<script>' + shim + '</script>');
html = html.replace('<head>', () => '<head>' + fonts);

mkdirSync(dirname(out), { recursive: true });
const tmp = join(dirname(out), '_' + basename(mockPath));
writeFileSync(tmp, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL(tmp).href);
await page.waitForFunction(() => window.__DONE === true, null, { timeout: 5000 });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out });
if (wantText) writeFileSync(out.replace(/\.png$/, '.txt'), await page.evaluate(() => document.body.innerText));
const missing = await page.evaluate(() => [...new Set(window.__MISSING || [])]);
await browser.close();
console.log(JSON.stringify({ out, errors, missingHoles: missing }));
