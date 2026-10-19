import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addedLines,
  freePath,
  isTest,
  itemDisputes,
  lockProblems,
  parseDisputes,
  protectedChanges,
  ruleViolations,
  tickProgress,
  untouchedVitestFailures,
  verifySteps,
} from './autopilot/gate-lib.mjs';

const GATE = join(import.meta.dirname, 'autopilot', 'gate.mjs');

test('autopilot gate: added lines and rule hits', () => {
  const token = ['gl', 'pat-', 'x'.repeat(24)].join('');
  const diff = [
    '+++ b/src/screens/a.module.css',
    '+  color: #ff0000;',
    '+++ b/src/styles/tokens.css',
    '+  --c: #ff0000;',
    '+++ b/src-tauri/src/claude/runner.rs',
    '+    args.push("--dangerously-skip-permissions");',
    `+++ b/tools/x.mjs`,
    `+const t = '${token}';`,
    '+++ b/docs/x.md',
    `+${token}`,
  ].join('\n');
  const hits = ruleViolations(addedLines(diff)).map((h) => `${h.rule} ${h.file}`);
  assert.deepEqual(hits, [
    'raw-color src/screens/a.module.css',
    'claude-flags src-tauri/src/claude/runner.rs',
    'gitlab-token tools/x.mjs',
  ]);
  assert.deepEqual(protectedChanges(['CLAUDE.md', 'src/a.ts']), ['CLAUDE.md']);
});

test('autopilot gate: PROGRESS tick keeps earlier commits; partial appends', () => {
  const md = '- [ ] F-07.2 Header. — partial: core (ecc02ae)\n- [ ] F-07.3 File.\n';
  assert.equal(
    tickProgress(md, 'F-07.2', ['abc1234'], true).split('\n')[0],
    '- [x] F-07.2 Header. (ecc02ae, abc1234)',
  );
  assert.equal(
    tickProgress(md, 'F-07.3', ['abc1234'], false).split('\n')[1],
    '- [ ] F-07.3 File. — partial: autopilot (abc1234)',
  );
  assert.throws(() => tickProgress(md, 'F-09.9', [], true), /no open line/);
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'gr-gate-'));
  const main = join(dir, 'main');
  const git = (args, cwd = main) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  mkdirSync(join(main, 'tools'), { recursive: true });
  mkdirSync(join(main, 'docs'), { recursive: true });
  mkdirSync(join(main, 'src'), { recursive: true });
  writeFileSync(join(main, 'tools', 'verify.mjs'), 'process.exit(0);\n');
  writeFileSync(join(main, 'tools', 'audit.mjs'), 'process.exit(0);\n');
  writeFileSync(join(main, 'docs', 'PROGRESS.md'), '## M3 · Test\n- [ ] F-01.1 Something.\n');
  writeFileSync(join(main, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(main, 'CLAUDE.md'), '# rules\n');
  git(['init', '-q', '-b', 'm3-test']);
  git(['config', 'core.autocrlf', 'false']);
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.']);
  git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base']);
  const wt = join(dir, 'gr-ap');
  git(['worktree', 'add', '-q', '-b', 'ap/f01-1', wt, 'm3-test']);
  const commit = (files, msg) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(wt, path, '..'), { recursive: true });
      writeFileSync(join(wt, path), text);
    }
    git(['add', '.'], wt);
    git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', msg], wt);
    return git(['rev-parse', '--short', 'HEAD'], wt);
  };
  const gate = (...extra) => {
    const r = spawnSync(
      process.execPath,
      [GATE, 'F-01.1', '--base', 'm3-test', '--root', main, '--worktree', wt, ...extra],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 't',
          GIT_AUTHOR_EMAIL: 't@t',
          GIT_COMMITTER_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@t',
        },
      },
    );
    return { code: r.status, verdict: JSON.parse(r.stdout) };
  };
  return { dir, main, wt, git, commit, gate };
}

test('E15 autopilot gate: verify runs only the steps the diff affects', () => {
  const js = ['typecheck', 'lint', 'format:check', 'test', 'test:tools'];
  const rust = ['rust:fmt', 'rust:clippy', 'rust:test'];
  assert.deepEqual(verifySteps(['src/screens/a.tsx', 'tests/e2e/a-f01-1.spec.ts']), js);
  assert.deepEqual(verifySteps(['src-tauri/src/gitlab/a.rs', 'src-tauri/tests/a.rs']), rust);
  assert.deepEqual(verifySteps(['src-tauri\\src\\a.rs']), rust, 'Windows separators');
  assert.equal(
    verifySteps(['src-tauri/src/a.rs', 'src/ipc/types/A.ts']),
    null,
    'a Rust type change',
  );
  assert.equal(verifySteps(['src/a.ts'], { full: true }), null);
  assert.equal(verifySteps([]), null);
});

test('E15 autopilot gate: the verdict names the verify steps; --full runs all', async () => {
  const r = repo();
  try {
    r.commit({ 'src/a.ts': 'export const a = 3;\n' }, 'impl');
    const first = r.gate('--no-merge');
    assert.deepEqual(first.verdict.verifySteps, [
      'typecheck',
      'lint',
      'format:check',
      'test',
      'test:tools',
    ]);
    assert.equal(typeof first.verdict.verifySecs, 'number');
    assert.equal(r.gate('--no-merge', '--full').verdict.verifySteps, 'all');
  } finally {
    await rm(r.dir, { recursive: true, force: true });
  }
});

test('autopilot gate: a clean item is ticked and fast-forwarded', async () => {
  const r = repo();
  try {
    const lock = r.commit({ 'src/a.test.ts': 'test("F-01.1 a", () => {});\n' }, 'tests');
    r.commit({ 'src/a.ts': 'export const a = 2;\n' }, 'impl');
    const { code, verdict } = r.gate('--lock', lock, '--tests', 'src/a.test.ts', '--complete');
    assert.equal(code, 0, JSON.stringify(verdict.checks));
    assert.equal(verdict.commits.length, 2);
    assert.equal(r.git(['rev-parse', '--short', 'HEAD']), verdict.merged);
    assert.match(
      readFileSync(join(r.main, 'docs', 'PROGRESS.md'), 'utf8'),
      /^- \[x\] F-01\.1 Something\. \(\w+, \w+\)$/m,
    );
  } finally {
    await rm(r.dir, { recursive: true, force: true });
  }
});

test('autopilot gate: changed locked tests, protected files and rule hits refuse the merge', async () => {
  const r = repo();
  try {
    const lock = r.commit({ 'src/a.test.ts': 'test("F-01.1 a", () => {});\n' }, 'tests');
    r.commit(
      {
        'src/a.test.ts': 'test.skip("F-01.1 a", () => {});\n',
        'CLAUDE.md': '# rules, relaxed\n',
        'src/b.module.css': '.x { color: #123456; }\n',
      },
      'impl',
    );
    const { code, verdict } = r.gate('--lock', lock, '--tests', 'src/a.test.ts', '--complete');
    assert.equal(code, 1);
    const failed = verdict.checks.filter((c) => !c.ok).map((c) => c.name);
    assert.deepEqual(failed, ['protected', 'locked-tests', 'rules']);
    assert.equal(verdict.merged, null);
    assert.equal(r.git(['log', '--oneline']).split('\n').length, 1);
  } finally {
    await rm(r.dir, { recursive: true, force: true });
  }
});

test('autopilot gate: test paths and accepted disputes of locked tests', () => {
  assert.deepEqual(
    [
      'src-tauri/src/store/sessions_progress_tests.rs',
      'src/screens/start/ResumeCards.test.tsx',
      'tests/e2e/start.spec.ts',
      'src-tauri/tests/plan_runs.rs',
      'src-tauri\\tests\\sources.rs',
      'src-tauri/src/store/sessions.rs',
      'src/screens/start/ResumeCards.tsx',
    ].map(isTest),
    [true, true, true, true, true, false, false],
  );
  const disputes = parseDisputes('tests/e2e/start.spec.ts@27e4848');
  assert.equal(disputes.get('tests/e2e/start.spec.ts'), '27e4848');
  assert.throws(() => parseDisputes('tests/e2e/start.spec.ts'), /file@sha/);
  const history = { 'tests/e2e/start.spec.ts': ['27e4848'], 'src/a.test.ts': ['1111111'] };
  const filesOf = { '27e4848': ['tests/e2e/start.spec.ts'] };
  const problems = (changed, d = disputes, h = history, f = filesOf) =>
    lockProblems(
      changed,
      d,
      (x) => h[x] ?? [],
      (x) => f[x] ?? [],
    );
  assert.deepEqual(problems(['tests/e2e/start.spec.ts']), []);
  assert.match(problems(['src/a.test.ts'])[0], /changed after the lock/);
  assert.match(
    problems(['tests/e2e/start.spec.ts'], disputes, {
      'tests/e2e/start.spec.ts': ['27e4848', '2222222'],
    })[0],
    /the dispute allows only 27e4848/,
  );
  assert.match(
    problems(['tests/e2e/start.spec.ts'], disputes, history, {
      '27e4848': ['tests/e2e/start.spec.ts', 'src/a.ts'],
    })[0],
    /also changes src\/a\.ts/,
  );
});

test('autopilot gate: a locked test changes only in its accepted dispute commit', async () => {
  const r = repo();
  try {
    const lock = r.commit(
      { 'src/a.test.ts': 'test("F-01.1 a");\n', 'src/b.test.ts': 'test("F-01.1 b");\n' },
      'tests',
    );
    r.commit({ 'src/a.ts': 'export const a = 2;\n' }, 'impl');
    const fix = r.commit({ 'src/a.test.ts': 'test("F-01.1 a, reading order");\n' }, 'dispute');
    const tests = ['--lock', lock, '--tests', 'src/a.test.ts,src/b.test.ts', '--no-merge'];
    const lockedCheck = (v) => v.checks.find((c) => c.name === 'locked-tests');
    const refused = r.gate(...tests);
    assert.equal(refused.code, 1);
    assert.match(lockedCheck(refused.verdict).detail, /changed after the lock/);
    const ok = r.gate(...tests, '--dispute', `src/a.test.ts@${fix}`);
    assert.equal(lockedCheck(ok.verdict).ok, true, JSON.stringify(ok.verdict.checks));
    assert.equal(lockedCheck(ok.verdict).detail, `disputed: src/a.test.ts@${fix}`);
    const mixed = r.commit(
      { 'src/b.test.ts': 'test("F-01.1 b, wider");\n', 'src/a.ts': 'export const a = 3;\n' },
      'dispute and code',
    );
    const both = r.gate(...tests, '--dispute', `src/a.test.ts@${fix},src/b.test.ts@${mixed}`);
    assert.match(
      lockedCheck(both.verdict).detail,
      /src\/b\.test\.ts: dispute commit \w+ also changes src\/a\.ts/,
    );
  } finally {
    await rm(r.dir, { recursive: true, force: true });
  }
});

test('autopilot gate: remembered disputes and the next free verdict file', () => {
  const backlog = {
    items: [{ id: 'F-01.1', disputes: ['src/a.test.ts@1111111', 'src/b.test.ts@2222222'] }],
  };
  assert.deepEqual(
    [...itemDisputes(backlog, 'F-01.1', 'src/b.test.ts@3333333')],
    [
      ['src/a.test.ts', '1111111'],
      ['src/b.test.ts', '3333333'],
    ],
  );
  assert.equal(itemDisputes(backlog, 'F-09.9', undefined).size, 0);
  assert.equal(itemDisputes(null, 'F-01.1', null).size, 0);
  const dir = 'C:\\Repos\\gr-ap 1\\items';
  const files = new Set([`${dir}\\gate-1.json`, `${dir}\\gate-2.json`, 'items/x.json']);
  const exists = (p) => files.has(p);
  assert.equal(freePath(`${dir}\\gate-1.json`, exists), `${dir}\\gate-3.json`);
  assert.equal(freePath(`${dir}\\gate-5.json`, exists), `${dir}\\gate-5.json`);
  assert.equal(freePath('items/x.json', exists), 'items/x-2.json');
});

test('autopilot gate: a dispute the backlog remembers applies to every later call; no verdict is overwritten', async () => {
  const r = repo();
  try {
    const lock = r.commit({ 'src/a.test.ts': 'test("F-01.1 a");\n' }, 'tests');
    r.commit({ 'src/a.ts': 'export const a = 2;\n' }, 'impl');
    const fix = r.commit({ 'src/a.test.ts': 'test("F-01.1 a, reading order");\n' }, 'dispute');
    const out = join('items', 'F-01.1', 'gate-1.json');
    const args = ['--lock', lock, '--tests', 'src/a.test.ts', '--no-merge', '--out', out];
    assert.equal(r.gate(...args).code, 1);
    mkdirSync(join(r.main, 'docs', 'process'), { recursive: true });
    const item = { id: 'F-01.1', status: 'review', disputes: [`src/a.test.ts@${fix}`] };
    writeFileSync(
      join(r.main, 'docs', 'process', 'backlog.json'),
      JSON.stringify({ items: [item] }),
    );
    const second = r.gate(...args);
    assert.equal(second.code, 0, JSON.stringify(second.verdict.checks));
    const saved = (n) =>
      JSON.parse(readFileSync(join(r.main, 'items', 'F-01.1', `gate-${n}.json`), 'utf8'));
    const locked = (v) => v.checks.find((c) => c.name === 'locked-tests');
    assert.equal(saved(1).pass, false);
    assert.match(locked(saved(1)).detail, /changed after the lock/);
    assert.equal(saved(2).pass, true);
    assert.equal(locked(saved(2)).detail, `disputed: src/a.test.ts@${fix}`);
  } finally {
    await rm(r.dir, { recursive: true, force: true });
  }
});

test('E22 autopilot gate: after the base is merged in, commits are the item own and the locked tests compare with the merge', async () => {
  const r = repo();
  const id = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
  try {
    // The branch started from the item before (implemented, in review), then got its tests.
    const before = r.commit({ 'src/shared.test.ts': 'a\nb\nc\nd\ne\nf\n' }, 'impl F-00.9');
    const lock = r.commit(
      { 'src/shared.test.ts': 'a\nb\nc\nd\ne\nf\ntest("F-01.1 y");\n', 'src/y.test.ts': 'y\n' },
      'tests',
    );
    // The item before merges with a fix round that changes its own line of the shared test file.
    r.git(['merge', '--ff-only', '-q', before]);
    writeFileSync(join(r.main, 'src', 'shared.test.ts'), 'A\nb\nc\nd\ne\nf\n');
    r.git([...id, 'commit', '-q', '-am', 'fix F-00.9']);
    r.git([...id, 'merge', '-q', '--no-edit', 'm3-test'], r.wt);
    const merge = r.git(['rev-parse', '--short', 'HEAD'], r.wt);
    const impl = r.commit({ 'src/a.ts': 'export const a = 2;\n' }, 'impl');
    const tests = ['--tests', 'src/shared.test.ts,src/y.test.ts', '--complete'];
    const lockedCheck = (v) => v.checks.find((c) => c.name === 'locked-tests');

    const old = r.gate('--lock', lock, ...tests);
    assert.equal(old.code, 1);
    assert.match(lockedCheck(old.verdict).detail, /src\/shared\.test\.ts changed after the lock/);
    const ok = r.gate('--lock', merge, ...tests);
    assert.equal(ok.code, 0, JSON.stringify(ok.verdict.checks));
    assert.deepEqual(ok.verdict.commits, [lock, impl], 'neither the merge nor the base commits');
    assert.equal(r.git(['rev-parse', '--short', 'HEAD']), ok.verdict.merged);
    assert.equal(readFileSync(join(r.main, 'src', 'shared.test.ts'), 'utf8').split('\n')[0], 'A');
    assert.ok(
      readFileSync(join(r.main, 'docs', 'PROGRESS.md'), 'utf8').includes(
        `- [x] F-01.1 Something. (${lock}, ${impl})\n`,
      ),
    );
  } finally {
    await rm(r.dir, { recursive: true, force: true });
  }
});

test('untouchedVitestFailures: only test failed on timeouts outside the diff (E24)', () => {
  const out = 'PASS  lint  30s\nFAIL  test  42s\nPASS  rust:test  90s\nFAILED: test';
  const log =
    ' FAIL  src/screens/step/LineComposer.test.tsx > F-09.7 x\nError: Test timed out in 5000ms.\n';
  assert.deepEqual(untouchedVitestFailures(out, log, ['src/screens/threads/A.tsx']), [
    'src/screens/step/LineComposer.test.tsx',
  ]);
  assert.equal(untouchedVitestFailures(out, log, ['src/screens/step/LineComposer.test.tsx']), null);
  assert.equal(untouchedVitestFailures(out, log.replace('timed out', 'failed'), []), null);
  assert.equal(untouchedVitestFailures(`${out}\nFAIL  lint  3s`, log, []), null);
});
