// Autopilot worktree naming (docs/process/AUTOPILOT.md §3): one worktree ../gr-ap, one branch per item.
import { resolve } from 'node:path';

/** The autopilot worktree next to the main checkout `root`. */
export const worktreePath = (root) => resolve(root, '..', 'gr-ap');

/** `F-07.2` → `f07-2`, `D-03` → `d03`: the item's branch is `ap/<slug>`. */
export function itemSlug(id) {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '')
    .replace(/\./g, '-');
}

/** Port of the autopilot's mock dev server and e2e: above the lanes (1421–1499) and the integrator (1500). */
export const AUTOPILOT_PORT = 1510;
