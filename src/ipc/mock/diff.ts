import type { FileDiff } from '../types/FileDiff';
import type { Hunk } from '../types/Hunk';
import type { Line } from '../types/Line';
import type { MockFile, MockRow } from './fixtures/changes';
import { layerOf } from './layer';

/** A changed row's key in its file: `o<old line>` or `n<new line>`; context has none. */
export const keyOf = (row: MockRow): string | null =>
  row[0] === 'd' ? `o${String(row[1])}` : row[0] === 'a' ? `n${String(row[1])}` : null;

/** Local changes: the keys already committed and the keys in the index. */
export interface LocalState {
  done?: Set<string>;
  staged?: Set<string>;
}

/** A mock file as `FileDiff`; `local` marks local changes (staging, committed rows). */
export function toFileDiff(file: MockFile, local?: LocalState): FileDiff {
  const done = local?.done;
  const inIndex = local?.staged;
  const hunks: Hunk[] = [];
  for (const hunk of file.hunks) {
    const lines: Line[] = [];
    for (const row of hunk.rows) {
      const key = keyOf(row);
      if (row[0] === 'c') {
        lines.push({ kind: 'ctx', oldNo: row[1], newNo: row[2], text: row[3], emphasis: [] });
      } else if (key && done?.has(key)) {
        // Committed: an added line is now context, a deleted line is gone.
        if (row[0] === 'a') {
          lines.push({ kind: 'ctx', oldNo: row[1], newNo: row[1], text: row[2], emphasis: [] });
        }
      } else if (row[0] === 'a') {
        lines.push({
          kind: 'add',
          newNo: row[1],
          text: row[2],
          emphasis: [],
          ...(local ? { staged: inIndex?.has(key ?? '') ?? false } : {}),
        });
      } else {
        lines.push({
          kind: 'del',
          oldNo: row[1],
          text: row[2],
          emphasis: [],
          ...(local ? { staged: inIndex?.has(key ?? '') ?? false } : {}),
        });
      }
    }
    if (!lines.some((l) => l.kind !== 'ctx')) continue;
    const oldNos = lines.map((l) => l.oldNo).filter((n): n is number => n !== undefined);
    const newNos = lines.map((l) => l.newNo).filter((n): n is number => n !== undefined);
    hunks.push({
      id: hunk.id,
      oldStart: oldNos[0] ?? 0,
      oldLines: oldNos.length,
      newStart: newNos[0] ?? 0,
      newLines: newNos.length,
      header: hunk.header,
      lines,
      fileLevel: false,
      stagedDiffers: false,
    });
  }
  const count = (kind: Line['kind']) =>
    hunks.flatMap((h) => h.lines).filter((l) => l.kind === kind).length;
  return {
    oldPath: file.status === 'added' ? undefined : (file.oldPath ?? file.path),
    newPath: file.status === 'deleted' ? undefined : file.path,
    status: file.status,
    binary: false,
    additions: count('add'),
    deletions: count('del'),
    layer: layerOf(file.path),
    hunks,
    lineStaging: local !== undefined,
  };
}
