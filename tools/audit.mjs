#!/usr/bin/env node
// Traceability audit: acceptance criteria (docs/01-product.md) vs PROGRESS.md vs tests.
// Usage: node tools/audit.mjs [--milestone M3] [--json]
// Exit code 1 when a ticked item has no test reference and is not in the manual checklist.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSpecIds,
  parseProgress,
  parseManualChecklist,
  isTestFile,
  extractTestRefs,
  buildRows,
  isFailing,
} from './audit-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const onlyMilestone = args.includes('--milestone') ? args[args.indexOf('--milestone') + 1] : null;
const asJson = args.includes('--json');

const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const specIds = parseSpecIds(read('docs', '01-product.md'));
const progressItems = parseProgress(read('docs', 'PROGRESS.md'));
const manual = parseManualChecklist(read('docs', '09-testing.md'));

// Test references: "F-06.10" in TS/JS test files, "f06_10_…" in names of Rust test functions
// (also inside module files with #[cfg(test)] mod tests).
const refs = new Map();
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'target' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    const rel = relative(root, p);
    if (!isTestFile(rel)) continue;
    for (const id of extractTestRefs(rel, readFileSync(p, 'utf8'))) {
      if (!refs.has(id)) refs.set(id, new Set());
      refs.get(id).add(rel);
    }
  }
};
['src', 'src-tauri', 'tests']
  .map((d) => join(root, d))
  .filter(existsSync)
  .forEach(walk);

const rows = buildRows({ specIds, progressItems, refs, manual, onlyMilestone });
const orphanProgress = [...progressItems.keys()].filter((id) => !specIds.includes(id));
const orphanTests = [...refs.keys()].filter((id) => !specIds.includes(id));

if (asJson) {
  console.log(JSON.stringify({ rows, orphanProgress, orphanTests }, null, 2));
} else {
  const done = rows.filter((r) => r.done).length;
  console.log(
    `Acceptance criteria: ${rows.length}${onlyMilestone ? ' in ' + onlyMilestone : ''} · done ${done} · open ${rows.length - done}`,
  );
  const bad = rows.filter((r) => r.problems.length);
  for (const r of bad)
    console.log(`  ${r.id.padEnd(8)} ${String(r.milestone).padEnd(4)} ${r.problems.join('; ')}`);
  if (orphanProgress.length) console.log('In PROGRESS but not in the spec: ' + orphanProgress.join(', '));
  if (orphanTests.length) console.log('Referenced in tests but not in the spec: ' + orphanTests.join(', '));
  if (!bad.length && !orphanProgress.length && !orphanTests.length) console.log('No gaps.');
}
process.exit(isFailing(rows) ? 1 : 0);
