#!/usr/bin/env node
// The autopilot worktree ../gr-ap (docs/process/AUTOPILOT.md §3): one item branch at a time.
//   node tools/autopilot/worktree.mjs ready F-07.2 --base m3-plan-focus   → JSON {path, branch, port, created}
//   node tools/autopilot/worktree.mjs done F-07.2      (after the merge: detach, delete the merged branch)
//   node tools/autopilot/worktree.mjs remove           (git worktree remove; refuses a dirty tree)
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTOPILOT_PORT, itemSlug, worktreePath } from './worktree-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const path = worktreePath(root);
const [cmd, item] = process.argv.slice(2);
const argv = process.argv.slice(2);
const base = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : null;

const git = (args, cwd = path) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
};
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (cmd === 'ready') {
  if (!item || !base) fail('usage: worktree.mjs ready <item> --base <milestone branch>');
  const branch = `ap/${itemSlug(item)}`;
  let created = false;
  if (!existsSync(path)) {
    const add = git(['worktree', 'add', '-b', branch, path, base], root);
    if (!add.ok) fail(add.out);
    // npm is a .cmd shim on Windows: one command string with a shell (as tools/lanes.mjs).
    const ci = spawnSync('npm ci --no-audit --no-fund', {
      cwd: path,
      shell: true,
      stdio: 'ignore',
    });
    if (ci.status !== 0) fail(`npm ci failed in ${path}`);
    created = true;
  } else {
    const dirty = git(['status', '--porcelain', '--untracked-files=no']);
    if (dirty.out) fail(`${path} has uncommitted changes:\n${dirty.out}`);
    const exists = git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]).ok;
    const sw = exists ? git(['switch', branch]) : git(['switch', '-c', branch, base]);
    if (!sw.ok) fail(sw.out);
    if (exists) {
      // A resumed item continues on top of what was merged since.
      const rb = git(['rebase', base]);
      if (!rb.ok) {
        git(['rebase', '--abort']);
        fail(`rebase of ${branch} onto ${base} failed: ${rb.out.slice(0, 300)}`);
      }
    }
  }
  console.log(
    JSON.stringify({ path: path.replace(/\\/g, '/'), branch, port: AUTOPILOT_PORT, created }),
  );
} else if (cmd === 'done') {
  if (!item) fail('usage: worktree.mjs done <item>');
  git(['switch', '--detach']);
  const del = git(['branch', '-d', `ap/${itemSlug(item)}`]);
  if (!del.ok) fail(del.out);
  console.log(`deleted ap/${itemSlug(item)}`);
} else if (cmd === 'remove') {
  const rm = git(['worktree', 'remove', path], root);
  if (!rm.ok) fail(rm.out);
  console.log(`removed ${path}`);
} else {
  fail('usage: worktree.mjs ready|done|remove');
}
