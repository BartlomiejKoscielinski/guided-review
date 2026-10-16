// Autopilot worktrees (docs/process/AUTOPILOT.md §3): ../gr-ap builds one item at a time, one
// branch per item; ../gr-ap-2 holds the test author of the next item while the current one is
// reviewed and gated (E22, tests ahead). Git steps take a runner `git(args, cwd) → { ok, out }`.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** The autopilot worktree next to the main checkout `root`. */
export const worktreePath = (root) => resolve(root, '..', 'gr-ap');

/** The second worktree: tests ahead of the item that ../gr-ap reviews and gates (E22). */
export const aheadPath = (root) => resolve(root, '..', 'gr-ap-2');

/** `F-07.2` → `f07-2`, `D-03` → `d03`: the item's branch is `ap/<slug>`. */
export function itemSlug(id) {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '')
    .replace(/\./g, '-');
}

/** Port of the autopilot's mock dev server and e2e: above the lanes (1421–1499) and the integrator (1500). */
export const AUTOPILOT_PORT = 1510;
/** Port of ../gr-ap-2, so its test author's e2e never meets the gate's. */
export const AHEAD_PORT = 1511;

const slash = (p) => p.replace(/\\/g, '/');
const branchOf = (id) => `ap/${itemSlug(id)}`;
const must = (r) => {
  if (!r.ok) throw new Error(r.out);
  return r.out;
};
/** The branch checked out in `wt`; null when it is detached or missing. */
const checkedOut = (git, wt) => {
  if (!existsSync(wt)) return null;
  const r = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], wt);
  return r.ok ? r.out : null;
};
const hasBranch = (git, root, branch) =>
  git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], root).ok;
const short = (git, cwd, rev) => must(git(['rev-parse', '--short', rev], cwd));

/** ../gr-ap-2 keeps only committed work: what a stopped test author left uncommitted is dropped. */
function scrub(git, wt2) {
  must(git(['reset', '--hard', '-q'], wt2));
  must(git(['clean', '-fdq'], wt2));
}

/** Frees `branch` when ../gr-ap-2 has it checked out; true when it did. */
function release(git, root, branch) {
  const wt2 = aheadPath(root);
  if (checkedOut(git, wt2) !== branch) return false;
  scrub(git, wt2);
  must(git(['switch', '-q', '--detach'], wt2));
  return true;
}

/**
 * Tests ahead (E22): ../gr-ap-2 on a fresh `ap/<item>` from the tip of `ap/<from>` (implemented,
 * still in review), so the test author sees the code before it. `fork` = that tip: `readyItem`
 * keeps the tests only when the fork reached the base. `install(path)` runs once, for a new worktree.
 */
export function prepareAhead({ git, root, item, from, install }) {
  const wt2 = aheadPath(root);
  const branch = branchOf(item);
  const source = branchOf(from);
  if (!hasBranch(git, root, source)) throw new Error(`no branch ${source}`);
  if (checkedOut(git, worktreePath(root)) === branch)
    throw new Error(`${branch} is checked out in ${slash(worktreePath(root))}`);
  const fork = short(git, root, `refs/heads/${source}`);
  let created = false;
  if (!existsSync(wt2)) {
    must(git(['worktree', 'add', '-q', '-B', branch, wt2, source], root));
    install(wt2);
    created = true;
  } else {
    scrub(git, wt2);
    must(git(['switch', '-q', '-C', branch, source], wt2));
  }
  return { path: slash(wt2), branch, port: AHEAD_PORT, fork, created };
}

/** Drops the tests ahead of `item` (its author failed or needs the owner): the branch is deleted. */
export function discardAhead({ git, root, item }) {
  const branch = branchOf(item);
  release(git, root, branch);
  if (!hasBranch(git, root, branch)) return { branch, deleted: false };
  must(git(['branch', '-q', '-D', branch], root));
  return { branch, deleted: true };
}

/**
 * ../gr-ap on the item's branch. `item` = its backlog entry ({ id, status, forkSha }). A new item
 * starts from `base`, a resumed one is rebased onto it. An item with tests ahead (`tests-ready`)
 * keeps them when its fork is on `base` and `base` merges cleanly: `tests: "kept"`, `lock` = the
 * merge (the gate compares the locked tests with it, so what the merge brought from `base` is not
 * a change of them). Else, and for a branch a stopped test author left in ../gr-ap-2, the branch
 * starts again from `base`: `tests: "discarded"` with the `reason`.
 */
export function readyItem({ git, root, item, base, install }) {
  const wt = worktreePath(root);
  const branch = branchOf(item.id);
  const out = { path: slash(wt), branch, port: AUTOPILOT_PORT, created: false };
  const leftAhead = release(git, root, branch);
  if (!existsSync(wt)) {
    must(git(['worktree', 'add', '-q', '--detach', wt, base], root));
    install(wt);
    out.created = true;
  } else {
    const dirty = must(git(['status', '--porcelain', '--untracked-files=no'], wt));
    if (dirty) throw new Error(`${slash(wt)} has uncommitted changes:\n${dirty}`);
  }
  const exists = hasBranch(git, root, branch);
  let reason = null;
  if (item.status === 'tests-ready') {
    if (!exists) reason = `no branch ${branch}`;
    else if (!item.forkSha || !git(['merge-base', '--is-ancestor', item.forkSha, base], wt).ok)
      reason = `${item.forkSha ?? 'no fork'} is not on ${base}: the item before was not merged`;
    else {
      must(git(['switch', '-q', branch], wt));
      const merge = git(['merge', '-q', '--no-edit', base], wt);
      if (merge.ok) return { ...out, tests: 'kept', lock: short(git, wt, 'HEAD') };
      const conflicts = git(['diff', '--name-only', '--diff-filter=U'], wt).out.split(/\r?\n/);
      git(['merge', '--abort'], wt);
      reason = `merging ${base} conflicts in ${conflicts.filter(Boolean).join(', ') || 'the tree'}`;
    }
  } else if (leftAhead) reason = 'a stopped test author left it in ../gr-ap-2';
  if (reason) {
    if (exists) {
      if (checkedOut(git, wt) === branch) must(git(['switch', '-q', '--detach'], wt));
      must(git(['branch', '-q', '-D', branch], root));
    }
    must(git(['switch', '-q', '-c', branch, base], wt));
    return { ...out, tests: 'discarded', reason };
  }
  if (!exists) {
    must(git(['switch', '-q', '-c', branch, base], wt));
    return out;
  }
  must(git(['switch', '-q', branch], wt));
  // A resumed item continues on top of what was merged since.
  const rb = git(['rebase', '-q', base], wt);
  if (!rb.ok) {
    git(['rebase', '--abort'], wt);
    throw new Error(`rebase of ${branch} onto ${base} failed: ${rb.out.slice(0, 300)}`);
  }
  return out;
}
