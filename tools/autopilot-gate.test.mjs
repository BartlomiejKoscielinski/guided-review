import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addedLines,
  protectedChanges,
  ruleViolations,
  tickProgress,
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
