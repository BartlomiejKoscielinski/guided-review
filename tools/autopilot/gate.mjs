#!/usr/bin/env node
// Autopilot gate (docs/process/AUTOPILOT.md §4 B2). Run by the conductor in the main checkout on
// the milestone branch; checks the item branch in the autopilot worktree and fast-forwards it.
//   node tools/autopilot/gate.mjs F-07.2 --base m3-plan-focus [--worktree ../gr-ap] [--branch ap/f07-2]
//        [--lock <sha> --tests a,b] [--e2e step,plan] [--port 1510] [--complete] [--no-merge] [--out f.json] [--root dir]
// Prints the JSON verdict (and writes it to --out); exit 0 when it passed, 1 when not, 2 on usage.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addedLines, protectedChanges, ruleViolations, tickProgress } from './gate-lib.mjs';
import { itemSlug } from './worktree-lib.mjs';

const args = process.argv.slice(2);
const item = args[0];
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : (args[i + 1] ?? fallback);
};
const has = (name) => args.includes(`--${name}`);
// --root: the main checkout (tests pass a throwaway repo); default: the checkout of this script.
const root = flag('root')
  ? resolve(flag('root'))
  : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!item || !flag('base')) {
  console.error('usage: gate.mjs <item> --base <milestone branch> [options]');
  process.exit(2);
}
const base = flag('base');
const wt = resolve(root, flag('worktree', join('..', 'gr-ap')));
const branch = flag('branch', `ap/${itemSlug(item)}`);
const lock = flag('lock');
const lockedTests = (flag('tests', '') ?? '').split(',').filter(Boolean);
const e2e = flag('e2e');
const port = flag('port', '1510');
const milestone = (base.match(/^m(\d+)/i) ?? [])[1];

const run = (cmd, argv, cwd, env) => {
  const r = spawnSync(cmd, argv, {
    cwd,
    encoding: 'utf8',
    env: env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
};
const git = (argv, cwd = wt) => run('git', argv, cwd);
const tail = (text, n = 12) => text.split(/\r?\n/).slice(-n).join('\n');

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, ...(detail ? { detail } : {}) });
  return ok;
};
const verdict = { item, branch, base, pass: false, checks, commits: [], merged: null };

function finish() {
  verdict.pass = checks.every((c) => c.ok) && checks.length > 0;
  const text = JSON.stringify(verdict, null, 2);
  const out = flag('out');
  if (out) {
    mkdirSync(dirname(resolve(root, out)), { recursive: true });
    writeFileSync(resolve(root, out), `${text}\n`);
  }
  console.log(text);
  process.exit(verdict.pass ? 0 : 1);
}

// 1. Cheap checks: branch, clean tree, commits, protected files, locked tests, rules.
const head = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (!check('branch', head.ok && head.out === branch, head.out)) finish();
const dirty = git(['status', '--porcelain', '--untracked-files=no']);
if (!check('clean', dirty.ok && dirty.out === '', dirty.out.slice(0, 300))) finish();
const log = git(['log', '--reverse', '--format=%h', `${base}..HEAD`]);
verdict.commits = log.out ? log.out.split(/\r?\n/) : [];
if (!check('commits', verdict.commits.length > 0, 'nothing to merge')) finish();
const files = git(['diff', '--name-only', `${base}...HEAD`])
  .out.split(/\r?\n/)
  .filter(Boolean);
const prot = protectedChanges(files);
check('protected', prot.length === 0, prot.join(', '));
if (lock && lockedTests.length) {
  const changed = git(['diff', '--name-only', lock, 'HEAD', '--', ...lockedTests]).out;
  check('locked-tests', changed === '', changed);
}
const hits = ruleViolations(addedLines(git(['diff', '-U0', `${base}...HEAD`]).out));
check('rules', hits.length === 0, hits.map((h) => `${h.rule} ${h.file}: ${h.text}`).join('\n'));
if (!checks.every((c) => c.ok)) finish();

// 2. verify (with e2e for UI items) in the worktree, on the autopilot port.
const verifyArgs = ['tools/verify.mjs', ...(e2e ? ['--e2e', ...e2e.split(',')] : [])];
const verify = run(process.execPath, verifyArgs, wt, { ...process.env, GR_PORT: port });
if (!check('verify', verify.ok, tail(verify.out))) finish();

// 3. PROGRESS tick on the item branch, then audit; a failed audit drops the tick commit.
if (milestone && /^F-\d\d\.\d+$/.test(item)) {
  const progressPath = join(wt, 'docs', 'PROGRESS.md');
  try {
    const ticked = tickProgress(
      readFileSync(progressPath, 'utf8'),
      item,
      verdict.commits,
      has('complete'),
    );
    writeFileSync(progressPath, ticked);
    git(['add', 'docs/PROGRESS.md']);
    const commit = git(['commit', '-q', '-m', `M${milestone}: PROGRESS ${item} (autopilot)`]);
    if (!check('progress', commit.ok, commit.out)) finish();
  } catch (e) {
    check('progress', false, e instanceof Error ? e.message : String(e));
    finish();
  }
  const audit = run(process.execPath, ['tools/audit.mjs', '--milestone', `M${milestone}`], wt);
  if (!check('audit', audit.ok, tail(audit.out, 8))) {
    git(['reset', '--hard', 'HEAD~1']);
    finish();
  }
}

// 4. Fast-forward the milestone branch in the main checkout.
if (!has('no-merge')) {
  const current = git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  if (!check('main-branch', current.out === base, current.out)) finish();
  const merge = git(['merge', '--ff-only', '-q', branch], root);
  if (!check('merge', merge.ok, merge.out)) finish();
  verdict.merged = git(['rev-parse', '--short', 'HEAD'], root).out;
}
finish();
