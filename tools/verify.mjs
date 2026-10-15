#!/usr/bin/env node
// Quiet runner for the /verify skill: runs the `npm run verify` steps (and e2e on request),
// writes each step's full output to .verify/<step>.log and prints one line per step.
// A failing step also prints its error lines (capped), so the full log rarely needs opening.
//
// Usage:
//   node tools/verify.mjs                         all verify steps
//   node tools/verify.mjs --only rust:clippy,test re-run selected steps
//   node tools/verify.mjs --e2e [spec ...]        verify steps + Playwright (all specs or the given ones)
//   node tools/verify.mjs --only e2e changes      Playwright only, one spec
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { laneConfig } from './lanes-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logDir = join(root, '.verify');
const STEPS = [
  'typecheck',
  'lint',
  'format:check',
  'test',
  'test:tools',
  'rust:fmt',
  'rust:clippy',
  'rust:test',
];
const MAX_LINES = 40;
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
// Lines worth showing from a failing step; everything else stays in the log.
const ERROR_LINE =
  /error|warning:|failed|FAIL|panicked|✘|×|expected|received|Timeout|not formatted|Diff in|^\s+at .*(src|tests)[\\/]|-->|^\s*\d+ \|/i;

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(',') : null;
const wantE2e = args.includes('--e2e') || (only?.includes('e2e') ?? false);
const specs = args.filter((a, i) => !a.startsWith('--') && i !== onlyIdx + 1);
// A lane worktree whose --owns has no src-tauri/ does not build Rust (tools/lanes.mjs).
const lane = laneConfig(root);
const noRust = !only && lane?.rust === false;
if (noRust) console.log(`lane ${lane.lane}: no src-tauri/ in --owns, Rust steps skipped`);
const steps = (only ?? STEPS).filter((s) => s !== 'e2e' && !(noRust && s.startsWith('rust:')));
for (const s of steps) {
  if (!STEPS.includes(s)) {
    console.error(`Unknown step "${s}". Steps: ${STEPS.join(', ')}, e2e`);
    process.exit(2);
  }
}

function run(name, command) {
  return new Promise((done) => {
    const started = Date.now();
    // Dev tooling only: npm/npx are .cmd shims on Windows and need a shell.
    const child = spawn(command, {
      cwd: root,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    const chunks = [];
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    child.on('close', (code) => {
      const output = Buffer.concat(chunks).toString('utf8').replace(ANSI, '');
      const log = join(logDir, name.replace(/[:\\/]/g, '_') + '.log');
      writeFileSync(log, output);
      done({ name, ok: code === 0, secs: ((Date.now() - started) / 1000).toFixed(1), output, log });
    });
  });
}

// Step timings for tools/metrics/report.mjs (what verify spends its time on).
function record({ name, ok, secs }) {
  const line = JSON.stringify({ at: new Date().toISOString(), step: name, secs: Number(secs), ok });
  appendFileSync(join(logDir, 'timings.jsonl'), line + String.fromCharCode(10));
}

function report({ name, ok, secs, output, log }) {
  record({ name, ok, secs });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${secs}s`);
  if (ok) return;
  const lines = output.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('> '));
  const hits = lines.filter((l) => ERROR_LINE.test(l));
  const shown = (hits.length ? hits : lines.slice(-MAX_LINES)).slice(0, MAX_LINES);
  for (const l of shown) console.log('  ' + l.slice(0, 220));
  const more = (hits.length || lines.length) - shown.length;
  console.log(`  … full log: ${log}${more > 0 ? ` (${more} more lines)` : ''}`);
}

mkdirSync(logDir, { recursive: true });
const results = [];
// Independent groups run in parallel (JS static checks, JS tests, Rust chain); steps inside a
// group stay sequential. Output is printed in STEPS order once everything finished.
// --serial restores the one-after-another run.
const GROUPS = [
  ['typecheck', 'lint', 'format:check'],
  ['test', 'test:tools'],
  ['rust:fmt', 'rust:clippy', 'rust:test'],
];
const lanes = args.includes('--serial')
  ? [steps]
  : GROUPS.map((g) => g.filter((s) => steps.includes(s))).filter((g) => g.length);
const done = await Promise.all(
  lanes.map(async (lane) => {
    const out = [];
    for (const step of lane) out.push(await run(step, `npm run ${step}`));
    return out;
  }),
);
const byName = new Map(done.flat().map((r) => [r.name, r]));
for (const step of steps) {
  const r = byName.get(step);
  report(r);
  results.push(r);
}
if (wantE2e) {
  const r = await run('e2e', `npx playwright test --reporter=line ${specs.join(' ')}`);
  report(r);
  results.push(r);
}
const failed = results.filter((r) => !r.ok).map((r) => r.name);
console.log(failed.length ? `FAILED: ${failed.join(', ')}` : 'ALL PASSED');
process.exit(failed.length ? 1 : 0);
