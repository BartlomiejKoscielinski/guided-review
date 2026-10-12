import type { CheckState } from '../components/Checkbox';
import type { Hunk } from '../ipc/types/Hunk';
import type { Line } from '../ipc/types/Line';
import type { LineRef } from '../ipc/types/LineRef';

/** What a hunk checkbox shows: from the index state of its change lines (F-16.1). */
export function hunkState(hunk: Hunk): CheckState {
  const changes = hunk.lines.filter((l) => l.kind !== 'ctx');
  const staged = changes.filter((l) => l.staged).length;
  if (staged === 0) return 'off';
  return staged === changes.length ? 'on' : 'mixed';
}

/** The line as the core names it: deleted lines by HEAD number, added by working-tree number. */
export function lineRef(line: Line): LineRef | null {
  if (line.kind === 'del' && line.oldNo !== undefined) return { side: 'old', no: line.oldNo };
  if (line.kind === 'add' && line.newNo !== undefined) return { side: 'new', no: line.newNo };
  return null;
}

/** All change lines of a hunk. */
export function hunkRefs(hunk: Hunk): LineRef[] {
  return hunk.lines.map(lineRef).filter((r): r is LineRef => r !== null);
}

/** Callbacks that write checkbox changes to the index; absent in commit mode. */
export interface DiffStaging {
  onHunk: (hunk: Hunk, stage: boolean) => void;
  onLine: (line: Line, stage: boolean) => void;
}
