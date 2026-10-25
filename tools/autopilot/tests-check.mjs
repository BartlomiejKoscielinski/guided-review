#!/usr/bin/env node
// E28: check a test author's commit before the implementer starts (autopilot SKILL d.1 and
// "Tests ahead reported"). Runs the cheap verify steps that a broken locked test fails
// (gate-lib testsCheckSteps) in the worktree and prints one JSON verdict.
//   node tools/autopilot/tests-check.mjs --worktree ../gr-ap --tests a,b [--port 1510]
// Exit 0 when green (or no test files), 1 when a step failed, 2 on usage.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { testsCheckSteps } from './gate-lib.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : (args[i + 1] ?? fallback);
};
const wt = flag('worktree');
const tests = (flag('tests', '') ?? '').split(',').filter(Boolean);
if (!wt) {
  console.error('usage: tests-check.mjs --worktree <dir> --tests a,b [--port 1510]');
  process.exit(2);
}
const steps = testsCheckSteps(tests);
if (!steps) {
  console.log(JSON.stringify({ pass: true, steps: [], detail: 'no test files' }));
  process.exit(0);
}
const r = spawnSync(process.execPath, ['tools/verify.mjs', '--only', steps.join(',')], {
  cwd: resolve(wt),
  encoding: 'utf8',
  env: { ...process.env, GR_PORT: flag('port', '1510') },
  maxBuffer: 64 * 1024 * 1024,
});
const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
const pass = r.status === 0;
console.log(
  JSON.stringify(
    { pass, steps, ...(pass ? {} : { detail: out.split(/\r?\n/).slice(-30).join('\n') }) },
    null,
    2,
  ),
);
process.exit(pass ? 0 : 1);
