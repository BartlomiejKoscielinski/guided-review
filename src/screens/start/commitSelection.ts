import type { CommitRange } from '../../ipc/types/CommitRange';
import type { CommitRow } from '../../ipc/types/CommitRow';
import { age } from './mrRow';

/** A click sets both ends; Shift+click moves only `end` (F-03.2). SHAs, so a search keeps it. */
export interface CommitSelection {
  anchor: string;
  end: string;
}

/** Selected rows as indices into the list (newest first): `first` ≤ `last`. */
export interface SelectedRows {
  first: number;
  last: number;
}

/** After a click on `sha`; Shift+click extends from the anchor, else from the shown default. */
export function nextSelection(
  rows: readonly CommitRow[],
  current: CommitSelection | null,
  sha: string,
  shift: boolean,
): CommitSelection {
  if (!shift) return { anchor: sha, end: sha };
  const listed = current !== null && rows.some((r) => r.sha === current.anchor);
  const anchor = listed ? current.anchor : (rows[0]?.sha ?? sha);
  return { anchor, end: sha };
}

/** The selection within `rows`; the newest commit when nothing (still listed) is selected. */
export function selectedRows(
  rows: readonly CommitRow[],
  selection: CommitSelection | null,
): SelectedRows | null {
  if (rows.length === 0) return null;
  const anchor = selection ? rows.findIndex((r) => r.sha === selection.anchor) : -1;
  if (anchor < 0) return { first: 0, last: 0 };
  const end = rows.findIndex((r) => r.sha === selection?.end);
  const other = end < 0 ? anchor : end;
  return { first: Math.min(anchor, other), last: Math.max(anchor, other) };
}

export function isRange(selected: SelectedRows): boolean {
  return selected.last > selected.first;
}

/**
 * What Review opens: one commit, or `from..to` with `from` the oldest selected commit's parent,
 * so it is reviewed too (`from` is excluded). A root commit has none; the range then starts at it.
 */
export function reviewRange(rows: readonly CommitRow[], selected: SelectedRows): CommitRange {
  const newest = rows[selected.first];
  const oldest = rows[selected.last];
  if (!newest || !oldest) throw new Error('Selection outside the list.');
  if (!isRange(selected)) return { to: newest.sha };
  return { from: oldest.parent ?? oldest.sha, to: newest.sha };
}

/** "Review a3f9c12" or "Review c4a19b0..a3f9c12" (oldest..newest selected). */
export function reviewLabel(rows: readonly CommitRow[], selected: SelectedRows): string {
  const newest = rows[selected.first]?.shortSha ?? '';
  const oldest = rows[selected.last]?.shortSha ?? '';
  return isRange(selected) ? `${oldest}..${newest}` : newest;
}

/** "Marta K. · 2 h", "You · yesterday", "Marta K. · 2 d" (Start.dc.html). */
export function commitMeta(row: CommitRow, now: number): string {
  const when = age(row.date, now);
  return `${row.author} · ${when === '1 d' ? 'yesterday' : when}`;
}
