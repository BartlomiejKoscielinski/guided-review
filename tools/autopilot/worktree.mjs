#!/usr/bin/env node
// The autopilot worktrees (docs/process/AUTOPILOT.md §3): ../gr-ap builds one item branch at a
// time; ../gr-ap-2 takes the test author of the next item meanwhile (E22, tests ahead).
//   node tools/autopilot/worktree.mjs ready F-07.2 --base m3-plan-focus
//        → JSON {path, branch, port, created[, tests: kept|discarded, lock | reason]} (tests ahead: see worktree-lib)
//   node tools/autopilot/worktree.mjs ahead F-07.3 --from F-07.2   → JSON {path, branch, port, fork, created}
//   node tools/autopilot/worktree.mjs discard F-07.3   (tests ahead dropped: ../gr-ap-2 detached, branch deleted)
//   node tools/autopilot/worktree.mjs done F-07.2      (after the merge: detach, delete the merged branch)
//   node tools/autopilot/worktree.mjs remove           (git worktree remove of both; refuses a dirty tree)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aheadPath,
  discardAhead,
  itemSlug,
  prepareAhead,
  readyItem,
  worktreePath,
} from './worktree-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const path = worktreePath(root);
const argv = process.argv.slice(2);
const [cmd, item] = argv;
const flag = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : null);

const git = (args, cwd = path) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
};
// npm is a .cmd shim on Windows: one command string with a shell (as tools/lanes.mjs).
const install = (wt) => {
  const ci = spawnSync('npm ci --no-audit --no-fund', { cwd: wt, shell: true, stdio: 'ignore' });
  if (ci.status !== 0) throw new Error(`npm ci failed in ${wt}`);
};
const backlogItem = (id) => {
  const file = join(root, 'docs', 'process', 'backlog.json');
  const items = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).items : [];
  return items.find((i) => i.id === id) ?? { id, status: 'todo' };
};
const usage = 'usage: worktree.mjs ready|ahead|discard|done|remove (see the header)';

try {
  if (cmd === 'ready') {
    const base = flag('base');
    if (!item || !base)
      throw new Error('usage: worktree.mjs ready <item> --base <milestone branch>');
    console.log(JSON.stringify(readyItem({ git, root, item: backlogItem(item), base, install })));
  } else if (cmd === 'ahead') {
    const from = flag('from');
    if (!item || !from) throw new Error('usage: worktree.mjs ahead <next item> --from <item>');
    console.log(JSON.stringify(prepareAhead({ git, root, item, from, install })));
  } else if (cmd === 'discard') {
    if (!item) throw new Error('usage: worktree.mjs discard <item>');
    console.log(JSON.stringify(discardAhead({ git, root, item })));
  } else if (cmd === 'done') {
    if (!item) throw new Error('usage: worktree.mjs done <item>');
    git(['switch', '--detach']);
    const del = git(['branch', '-d', `ap/${itemSlug(item)}`]);
    if (!del.ok) throw new Error(del.out);
    console.log(`deleted ap/${itemSlug(item)}`);
  } else if (cmd === 'remove') {
    for (const wt of [aheadPath(root), path].filter((p) => existsSync(p))) {
      const rm = git(['worktree', 'remove', wt], root);
      if (!rm.ok) throw new Error(rm.out);
      console.log(`removed ${wt}`);
    }
  } else {
    throw new Error(usage);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
