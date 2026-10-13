#!/usr/bin/env node
// One-shot data gathering for the /design-check skill, so the agent reads one text report instead
// of running shots, renders, diffs and greps one by one. For each design state of a screen:
//   1. captures the implementation (design-shots spec: PNG + text elements with computed styles),
//   2. renders the mock state (states.json) with its text elements and styles,
//   3. pixel heatmap + side-by-side crops of the most different cells (diff-shots.mjs),
//   4. DOM comparison: copy, typography, token colors, shifted elements (compare-dom.mjs).
// Prints a capped summary; the full report goes to .design-check/report-<screen>.md.
//
// Usage:
//   node tools/mock-preview/design-check.mjs S06 [--states changes-local,changes-commit]
//        [--no-shots] [--top 3] [--max-lines 12]
// Requires the mock dev server or lets Playwright start it (playwright.config.ts webServer).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareDom, loadTokenColors } from './compare-dom.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const screen = (args[0] ?? '').toUpperCase().replace('-', '');
if (!/^S\d\d$/.test(screen)) {
  console.error('Usage: design-check.mjs S06 [--states a,b] [--no-shots] [--top 3] [--max-lines 12]');
  process.exit(2);
}
const top = opt('top', '3');
const maxLines = Number(opt('max-lines', 12));
const out = join(root, '.design-check');
mkdirSync(out, { recursive: true });

const spec = readFileSync(join(root, 'tests', 'e2e', 'design-shots.spec.ts'), 'utf8');
const specStates = [...spec.matchAll(/screen: '(S\d\d)',\s*state: '([^']+)'/g)].filter((m) => m[1] === screen).map((m) => m[2]);
const states = opt('states', null)?.split(',') ?? specStates;
if (!states.length) {
  console.error(`No design shots for ${screen} in tests/e2e/design-shots.spec.ts: add its states first.`);
  process.exit(2);
}
const mapping = JSON.parse(readFileSync(join(here, 'states.json'), 'utf8'));
const tokens = loadTokenColors(join(root, 'src', 'styles', 'tokens.css'));

const node = (script, scriptArgs) =>
  execFileSync(process.execPath, [script, ...scriptArgs], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

if (!args.includes('--no-shots')) {
  const grep = `design shot ${screen} (${states.map(esc).join('|')})$`;
  try {
    const log = node(join(root, 'node_modules', '@playwright', 'test', 'cli.js'), ['test', 'design-shots', '--reporter=line', '-g', grep]);
    console.log(`shots: ${(log.match(/(\d+) passed/) ?? [, '?'])[1]} passed`);
  } catch (e) {
    console.log('shots FAILED:\n' + String(e.stdout ?? '').split('\n').slice(-30).join('\n') + String(e.stderr ?? '').slice(-2000));
    process.exit(1);
  }
}

const report = [`# design-check ${screen}`, ''];
for (const state of states) {
  const id = `${screen}-${state}`;
  const lines = [];
  const impl = join(out, `impl-${id}`);
  const m = mapping[id];
  if (!existsSync(impl + '.png')) {
    console.log(`\n## ${id}: no implementation shot (${impl}.png)`);
    continue;
  }
  let mockJson = null;
  if (m) {
    const mockOut = join(out, `mock-${id}.png`);
    const r = JSON.parse(
      node(join(here, 'render-mock.mjs'), [m.mock, '--state', JSON.stringify(m.state), '--out', mockOut, '--styles', ...(m.height ? ['--height', String(m.height)] : [])]),
    );
    if (r.errors.length || r.missingHoles.length) lines.push(`mock render: errors ${JSON.stringify(r.errors)} missing holes ${JSON.stringify(r.missingHoles)}`);
    mockJson = mockOut.replace(/\.png$/, '.json');
  } else lines.push(`no row in tools/mock-preview/states.json: pixel diff only, no DOM comparison`);

  const designPng = join(root, 'docs', 'design', 'screens', `${id}.png`);
  const reference = existsSync(designPng) ? designPng : m ? join(out, `mock-${id}.png`) : null;
  if (!existsSync(designPng)) lines.push(m ? 'no design PNG: diffed against the rendered mock' : 'no design PNG and no mock state: nothing to compare');
  if (reference) lines.push(...node(join(here, 'diff-shots.mjs'), [reference, impl + '.png', '--top', top, '--out-prefix', join(out, `cmp-${id}`)]).trimEnd().split('\n'));

  const sections = mockJson && existsSync(impl + '.json')
    ? compareDom(JSON.parse(readFileSync(mockJson, 'utf8')), JSON.parse(readFileSync(impl + '.json', 'utf8')), tokens)
    : [];

  console.log(`\n## ${id}`);
  console.log(lines.join('\n'));
  report.push(`## ${id}`, '', '```', ...lines, '```', '');
  if (!sections.length && mockJson) console.log('DOM: no differences');
  for (const [title, items] of sections) {
    console.log(`### ${title}`);
    console.log(items.slice(0, maxLines).join('\n') + (items.length > maxLines ? `\n… +${items.length - maxLines} more in the report` : ''));
    report.push(`### ${title}`, '', ...items.map((l) => `- ${l}`), '');
  }
}
const reportFile = join(out, `report-${screen}.md`);
writeFileSync(reportFile, report.join('\n'));
console.log(`\nfull report: ${reportFile}`);
