import type { FileDiff } from '../ipc/types/FileDiff';
import type { Hunk } from '../ipc/types/Hunk';
import type { Line } from '../ipc/types/Line';

export type DiffLayout = 'unified' | 'split';

/** One virtualized row of the diff list. */
export type DiffRow =
  | { kind: 'hunk'; key: string; hunk: Hunk; first: boolean }
  | { kind: 'line'; key: string; hunk: Hunk; line: Line; last: boolean }
  | { kind: 'pair'; key: string; hunk: Hunk; left?: Line; right?: Line; last: boolean }
  | { kind: 'note'; key: string };

/**
 * Unified rows: each hunk's header, then its lines. Split rows pair deleted and added lines by
 * position inside each run (docs/05 › Diff parsing); context lines sit on both sides.
 */
export function buildRows(diff: FileDiff, layout: DiffLayout, note: boolean): DiffRow[] {
  const rows: DiffRow[] = [];
  diff.hunks.forEach((hunk, h) => {
    if (hunk.fileLevel) return;
    rows.push({ kind: 'hunk', key: `${hunk.id}#h`, hunk, first: h === 0 });
    const lineRows = layout === 'unified' ? unified(hunk) : split(hunk);
    rows.push(...lineRows);
  });
  if (note) rows.push({ kind: 'note', key: 'note' });
  return rows;
}

function unified(hunk: Hunk): DiffRow[] {
  return hunk.lines.map((line, i) => ({
    kind: 'line',
    key: `${hunk.id}#${String(i)}`,
    hunk,
    line,
    last: i === hunk.lines.length - 1,
  }));
}

function split(hunk: Hunk): DiffRow[] {
  const out: DiffRow[] = [];
  const lines = hunk.lines;
  let i = 0;
  const push = (left: Line | undefined, right: Line | undefined) => {
    out.push({
      kind: 'pair',
      key: `${hunk.id}#${String(out.length)}`,
      hunk,
      left,
      right,
      last: false,
    });
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line) break;
    if (line.kind === 'ctx') {
      push(line, line);
      i += 1;
      continue;
    }
    const dels: Line[] = [];
    const adds: Line[] = [];
    while (i < lines.length && lines[i]?.kind === 'del') dels.push(lines[i++] as Line);
    while (i < lines.length && lines[i]?.kind === 'add') adds.push(lines[i++] as Line);
    for (let k = 0; k < Math.max(dels.length, adds.length); k += 1) push(dels[k], adds[k]);
  }
  const last = out.at(-1);
  if (last?.kind === 'pair') last.last = true;
  return out;
}

/** "lines 22–25" from the hunk's new side (old side for deletions). */
export function hunkRange(hunk: Hunk): string {
  const [start, count] =
    hunk.newLines > 0 ? [hunk.newStart, hunk.newLines] : [hunk.oldStart, hunk.oldLines];
  return count <= 1
    ? `line ${String(start)}`
    : `lines ${String(start)}–${String(start + count - 1)}`;
}
