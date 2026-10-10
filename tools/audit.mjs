#!/usr/bin/env node
// Traceability audit: acceptance criteria (docs/01-product.md) vs PROGRESS.md vs tests.
// Usage: node tools/audit.mjs [--milestone M3] [--json]
// Exit code 1 when a ticked item has no test reference and is not in the manual checklist.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const onlyMilestone = args.includes('--milestone') ? args[args.indexOf('--milestone') + 1] : null;
const asJson = args.includes('--json');

const product = readFileSync(join(root, 'docs', '01-product.md'), 'utf8');
const progress = readFileSync(join(root, 'docs', 'PROGRESS.md'), 'utf8');
const testing = readFileSync(join(root, 'docs', '09-testing.md'), 'utf8');

const specIds = [...product.matchAll(/^- \*\*((?:F-\d\d\.\d+)|(?:NFR-\d\d))\b/gm)].map((m) => m[1]);

// PROGRESS: "## M3 · …" headers and "- [x] F-06.4 … (sha)" lines
const progressItems = new Map();
let milestone = null;
for (const line of progress.split(/\r?\n/)) {
  const h = line.match(/^## (M\d+) /);
  if (h) { milestone = h[1]; continue; }
  const m = line.match(/^- \[( |x)\] ((?:F-\d\d\.\d+)|(?:NFR-\d\d))\b(.*)$/);
  if (m) progressItems.set(m[2], { milestone, done: m[1] === 'x', sha: (m[3].match(/\(([0-9a-f]{7,40})\)\s*$/) || [])[1] || null, partial: /— partial:/.test(m[3]) });
}

// Test references: "F-06.10" or "f06_10" in test files
const testDirs = ['src', 'src-tauri', 'tests'].map((d) => join(root, d)).filter(existsSync);
const testExt = new Set(['.ts', '.tsx', '.rs', '.mjs', '.js']);
const refs = new Map();
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'target' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (testExt.has(extname(name)) && /(test|spec|tests)/i.test(p)) {
      const text = readFileSync(p, 'utf8');
      for (const m of text.matchAll(/\b(?:F-(\d\d)\.(\d+)|f(\d\d)_(\d+)|NFR-(\d\d)|nfr_?(\d\d))\b/g)) {
        const id = m[1] ? `F-${m[1]}.${m[2]}` : m[3] ? `F-${m[3]}.${m[4]}` : `NFR-${m[5] || m[6]}`;
        if (!refs.has(id)) refs.set(id, new Set());
        refs.get(id).add(p.slice(root.length + 1));
      }
    }
  }
};
testDirs.forEach(walk);
const manual = new Set([...testing.matchAll(/^- \[ \] ((?:F-\d\d\.\d+)|(?:NFR-\d\d))\b/gm)].map((m) => m[1]));

const rows = specIds.map((id) => {
  const p = progressItems.get(id);
  const tests = refs.get(id) ? [...refs.get(id)] : [];
  const problems = [];
  if (!p) problems.push('missing in PROGRESS');
  if (p && p.done && !p.sha) problems.push('ticked without commit SHA');
  if (p && p.done && tests.length === 0 && !manual.has(id)) problems.push('ticked without test or manual check');
  if (p && !p.done && tests.length > 0) problems.push('has tests but not ticked');
  return { id, milestone: p ? p.milestone : null, done: !!(p && p.done), partial: !!(p && p.partial), tests, manual: manual.has(id), problems };
}).filter((r) => !onlyMilestone || r.milestone === onlyMilestone);

const orphanProgress = [...progressItems.keys()].filter((id) => !specIds.includes(id));
const orphanTests = [...refs.keys()].filter((id) => !specIds.includes(id));

if (asJson) {
  console.log(JSON.stringify({ rows, orphanProgress, orphanTests }, null, 2));
} else {
  const done = rows.filter((r) => r.done).length;
  console.log(`Acceptance criteria: ${rows.length}${onlyMilestone ? ' in ' + onlyMilestone : ''} · done ${done} · open ${rows.length - done}`);
  const bad = rows.filter((r) => r.problems.length);
  for (const r of bad) console.log(`  ${r.id.padEnd(8)} ${String(r.milestone).padEnd(4)} ${r.problems.join('; ')}`);
  if (orphanProgress.length) console.log('In PROGRESS but not in the spec: ' + orphanProgress.join(', '));
  if (orphanTests.length) console.log('Referenced in tests but not in the spec: ' + orphanTests.join(', '));
  if (!bad.length && !orphanProgress.length && !orphanTests.length) console.log('No gaps.');
}
const failing = rows.some((r) => r.problems.some((p) => p.startsWith('ticked without') || p === 'missing in PROGRESS'));
process.exit(failing ? 1 : 0);
