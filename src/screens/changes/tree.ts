import type { CheckState } from '../../components/Checkbox';
import type { FileGroup } from '../../ipc/types/FileGroup';
import type { TreeFile } from '../../ipc/types/TreeFile';

/** Local trees up to this size open every folder; larger ones open the selected file's. */
const OPEN_ALL_UP_TO = 30;

export type TreeRow =
  | {
      kind: 'folder';
      dir: string;
      open: boolean;
      /** "12", or "3/12" while filtering. */
      count: string;
      /** Every file of the folder (the folder checkbox acts on all of them). */
      files: TreeFile[];
    }
  | { kind: 'file'; file: TreeFile };

export interface TreeOptions {
  filter: string;
  local: boolean;
  selected: string | undefined;
  /** The user's open/closed choices; other folders follow the default. */
  folders: Readonly<Record<string, boolean>>;
}

export function matches(file: TreeFile, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || file.path.toLowerCase().includes(q);
}

/** Visible rows of the S-06 tree (F-15.2, F-15.3). */
export function flattenTree(groups: readonly FileGroup[], options: TreeOptions): TreeRow[] {
  const q = options.filter.trim();
  const total = groups.reduce((n, g) => n + g.files.length, 0);
  const rows: TreeRow[] = [];
  for (const group of groups) {
    const shown = group.files.filter((f) => matches(f, q));
    if (shown.length === 0) continue;
    const byDefault =
      !options.local ||
      total <= OPEN_ALL_UP_TO ||
      group.files.some((f) => f.path === options.selected);
    const open = q !== '' || (options.folders[group.dir] ?? byDefault);
    rows.push({
      kind: 'folder',
      dir: group.dir,
      open,
      count: q
        ? `${String(shown.length)}/${String(group.files.length)}`
        : String(group.files.length),
      files: group.files,
    });
    if (open) rows.push(...shown.map((file): TreeRow => ({ kind: 'file', file })));
  }
  return rows;
}

/** Number shown in the filter input: matches while filtering, else all files (02 › S-06). */
export function filterCount(groups: readonly FileGroup[], filter: string): number {
  return groups.reduce((n, g) => n + g.files.filter((f) => matches(f, filter)).length, 0);
}

/** Checkbox of a set of files: on when all are fully staged, off when none is staged. */
export function stageCheck(files: readonly TreeFile[]): CheckState {
  if (files.length === 0) return 'off';
  if (files.every((f) => f.staged === 'all')) return 'on';
  if (files.every((f) => f.staged === 'none' || f.staged === undefined)) return 'off';
  return 'mixed';
}

/** The first file in tree order. */
export function firstFile(groups: readonly FileGroup[]): TreeFile | undefined {
  return groups[0]?.files[0];
}

/** Finds a file by path. */
export function findFile(
  groups: readonly FileGroup[],
  path: string | undefined,
): TreeFile | undefined {
  if (path === undefined) return undefined;
  for (const group of groups) {
    const file = group.files.find((f) => f.path === path);
    if (file) return file;
  }
  return undefined;
}
