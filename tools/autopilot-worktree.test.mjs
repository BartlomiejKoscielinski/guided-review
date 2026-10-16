import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aheadPath,
  discardAhead,
  prepareAhead,
  readyItem,
  worktreePath,
} from './autopilot/worktree-lib.mjs';

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};
const git = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
};

/** A main checkout on m3-test in a folder with a space and a Polish letter; worktrees next to it. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'gr wt ł-'));
  const root = join(dir, 'main');
  const run = (args, cwd = root) => {
    const r = git(args, cwd);
    assert.ok(r.ok, `git ${args.join(' ')}: ${r.out}`);
    return r.out;
  };
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'src', 'shared.ts'), 'one\ntwo\nthree\n');
  run(['init', '-q', '-b', 'm3-test']);
  run(['config', 'core.autocrlf', 'false']);
  run(['add', '.']);
  run(['commit', '-q', '-m', 'base']);
  const installed = [];
  const install = (path) => installed.push(path);
  const write = (wt, files) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(wt, path, '..'), { recursive: true });
      writeFileSync(join(wt, path), text);
    }
  };
  const commit = (wt, files, msg) => {
    write(wt, files);
    run(['add', '.'], wt);
    run(['commit', '-q', '-m', msg], wt);
    return run(['rev-parse', '--short', 'HEAD'], wt);
  };
  const wt = worktreePath(root);
  const ready = (item) => readyItem({ git, root, item, base: 'm3-test', install });
  const ahead = (item, from) => prepareAhead({ git, root, item, from, install });
  // What the gate and `worktree.mjs done` do for a passed item.
  const merge = (slug) => {
    run(['merge', '--ff-only', '-q', `ap/${slug}`]);
    run(['switch', '-q', '--detach'], wt);
    run(['branch', '-q', '-d', `ap/${slug}`]);
  };
  const read = (w, path) => readFileSync(join(w, path), 'utf8');
  const head = (w) => run(['rev-parse', '--short', 'HEAD'], w);
  const branchIn = (w) => git(['symbolic-ref', '--quiet', '--short', 'HEAD'], w).out || null;
  return {
    dir,
    root,
    wt,
    wt2: aheadPath(root),
    run,
    write,
    commit,
    ready,
    ahead,
    merge,
    read,
    head,
    branchIn,
    installed,
  };
}

test('E22 tests ahead: written in ../gr-ap-2 on the item before, kept after its merge, locked at the merge', async () => {
  const r = repo();
  try {
    const x = r.ready({ id: 'F-01.1', status: 'tests' });
    assert.deepEqual(
      { branch: x.branch, port: x.port, created: x.created, tests: x.tests },
      { branch: 'ap/f01-1', port: 1510, created: true, tests: undefined },
    );
    r.commit(r.wt, { 'src/a.ts': 'export const a = 2;\n' }, 'impl F-01.1');
    const y = r.ahead('F-01.2', 'F-01.1');
    assert.deepEqual(
      { branch: y.branch, port: y.port, created: y.created, fork: y.fork },
      { branch: 'ap/f01-2', port: 1511, created: true, fork: r.head(r.wt) },
    );
    assert.equal(r.read(r.wt2, 'src/a.ts'), 'export const a = 2;\n', 'sees the code before it');
    const lock = r.commit(r.wt2, { 'src/b.test.ts': 'test("F-01.2 b", () => {});\n' }, 'tests');
    // Meanwhile F-01.1 gets a fix round, passes its gate and is merged.
    r.commit(r.wt, { 'src/a.ts': 'export const a = 3;\n' }, 'fix F-01.1');
    r.merge('f01-1');

    const kept = r.ready({ id: 'F-01.2', status: 'tests-ready', lockSha: lock, forkSha: y.fork });
    assert.equal(kept.tests, 'kept', kept.reason);
    assert.equal(kept.port, 1510);
    assert.equal(r.branchIn(r.wt), 'ap/f01-2');
    assert.equal(r.branchIn(r.wt2), null, '../gr-ap-2 let the branch go');
    assert.equal(kept.lock, r.head(r.wt));
    assert.notEqual(kept.lock, lock, 'the lock moves to the merge of the base');
    assert.equal(r.read(r.wt, 'src/a.ts'), 'export const a = 3;\n', 'the fix round is merged in');
    assert.ok(existsSync(join(r.wt, 'src', 'b.test.ts')));
    assert.ok(git(['merge-base', '--is-ancestor', 'm3-test', 'HEAD'], r.wt).ok, 'gate can ff');
    assert.deepEqual(r.installed, [r.wt, r.wt2], 'npm ci once per new worktree');

    // The next tests ahead reuse ../gr-ap-2.
    const z = r.ahead('F-01.3', 'F-01.2');
    assert.equal(z.created, false);
    assert.equal(r.branchIn(r.wt2), 'ap/f01-3');
    assert.ok(existsSync(join(r.wt2, 'src', 'b.test.ts')));
    assert.equal(r.installed.length, 2);
  } finally {
    await rm(r.dir, { recursive: true, force: true });
  }
});

test('E22 tests ahead are discarded when the item before was not merged', async () => {
  const r = repo();
  try {
    r.ready({ id: 'F-01.1', status: 'tests' });
    r.commit(r.wt, { 'src/a.ts': 'export const a = 2;\n' }, 'impl F-01.1');
    const y = r.ahead('F-01.2', 'F-01.1');
    const lock = r.commit(r.wt2, { 'src/b.test.ts': 'test("F-01.2 b", () => {});\n' }, 'tests');
    // F-01.1 fails its gate (blocked): its branch stays, nothing reaches m3-test.
    const out = r.ready({ id: 'F-01.2', status: 'tests-ready', lockSha: lock, forkSha: y.fork });
    assert.equal(out.tests, 'discarded');
    assert.match(out.reason, /is not on m3-test: the item before was not merged/);
    assert.equal(r.branchIn(r.wt), 'ap/f01-2');
    assert.equal(r.head(r.wt), r.run(['rev-parse', '--short', 'm3-test']), 'starts from the base');
    assert.equal(r.read(r.wt, 'src/a.ts'), 'export const a = 1;\n', 'none of the blocked code');
    assert.equal(existsSync(join(r.wt, 'src', 'b.test.ts')), false);
    assert.ok(git(['rev-parse', '--verify', '--quiet', 'refs/heads/ap/f01-1'], r.root).ok);
  } finally {
    await rm(r.dir, { recursive: true, force: true });
  }
});

test('E22 tests ahead are discarded when merging the base conflicts; no merge is left open', async () => {
  const r = repo();
  try {
    r.ready({ id: 'F-01.1', status: 'tests' });
    r.commit(r.wt, { 'src/shared.ts': 'one\ntwo X\nthree\n' }, 'impl F-01.1');
    const y = r.ahead('F-01.2', 'F-01.1');
    const lock = r.commit(r.wt2, { 'src/shared.ts': 'one\ntwo Y\nthree\n' }, 'tests');
    r.commit(r.wt, { 'src/shared.ts': 'one\ntwo X fixed\nthree\n' }, 'fix F-01.1');
    r.merge('f01-1');
    const out = r.ready({ id: 'F-01.2', status: 'tests-ready', lockSha: lock, forkSha: y.fork });
    assert.equal(out.tests, 'discarded');
    assert.match(out.reason, /merging m3-test conflicts in src\/shared\.ts/);
    assert.equal(git(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], r.wt).ok, false);
    assert.equal(r.run(['status', '--porcelain'], r.wt), '');
    assert.equal(r.branchIn(r.wt), 'ap/f01-2');
    assert.equal(r.head(r.wt), r.run(['rev-parse', '--short', 'm3-test']));
    assert.equal(r.read(r.wt, 'src/shared.ts'), 'one\ntwo X fixed\nthree\n');
  } finally {
    await rm(r.dir, { recursive: true, force: true });
  }
});

test('E22 a stopped or failed test author: ../gr-ap-2 is scrubbed and its branch dropped', async () => {
  const r = repo();
  try {
    r.ready({ id: 'F-01.1', status: 'tests' });
    r.commit(r.wt, { 'src/a.ts': 'export const a = 2;\n' }, 'impl F-01.1');
    r.ahead('F-01.2', 'F-01.1');
    r.commit(r.wt2, { 'src/half.test.ts': 'test("F-01.2 half", () => {});\n' }, 'half');
    r.write(r.wt2, { 'src/a.ts': 'export const a = 9;\n', 'src/new.test.ts': 'x\n' });
    // The run stopped while the author wrote; the next run starts F-01.2 the usual way.
    const out = r.ready({ id: 'F-01.2', status: 'tests' });
    assert.equal(out.tests, 'discarded');
    assert.match(out.reason, /stopped test author/);
    assert.equal(r.head(r.wt), r.run(['rev-parse', '--short', 'm3-test']));
    assert.equal(existsSync(join(r.wt, 'src', 'half.test.ts')), false);
    assert.equal(r.branchIn(r.wt2), null);
    assert.equal(r.run(['status', '--porcelain'], r.wt2), '');
    assert.equal(existsSync(join(r.wt2, 'src', 'new.test.ts')), false);

    // An author that failed or needs the owner: `discard` deletes its branch.
    r.ahead('F-01.3', 'F-01.1');
    assert.deepEqual(discardAhead({ git, root: r.root, item: 'F-01.3' }), {
      branch: 'ap/f01-3',
      deleted: true,
    });
    assert.equal(r.branchIn(r.wt2), null);
    assert.equal(discardAhead({ git, root: r.root, item: 'F-01.3' }).deleted, false);
    assert.throws(() => r.ahead('F-01.4', 'F-09.9'), /no branch ap\/f09-9/);
    assert.throws(() => r.ahead('F-01.2', 'F-01.1'), /ap\/f01-2 is checked out in/);
  } finally {
    await rm(r.dir, { recursive: true, force: true });
  }
});
