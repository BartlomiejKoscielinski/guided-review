import type { FileDiff } from '../ipc/types/FileDiff';
import type { Hunk } from '../ipc/types/Hunk';
import type { Line } from '../ipc/types/Line';
import type { MechanicalReason } from '../ipc/types/MechanicalReason';

export type DiffLayout = 'unified' | 'split';

/** A region collapsed to a fold row until **Show** (F-07.4), as new-side lines. */
export interface DiffFold {
  newStart: number;
  newEnd: number;
  label: string;
}

/** One virtualized row of the diff list. */
export type DiffRow =
  | { kind: 'hunk'; key: string; hunk: Hunk; first: boolean }
  | { kind: 'line'; key: string; hunk: Hunk; line: Line; last: boolean }
  | { kind: 'pair'; key: string; hunk: Hunk; left?: Line; right?: Line; last: boolean }
  | { kind: 'fold'; key: string; label: string }
  | { kind: 'insert'; key: string; at: string }
  | { kind: 'note'; key: string };

export interface RowOptions {
  /** A note row under the last hunk. */
  note?: boolean;
  /** Hunk header bars (S-03 shows none). */
  headers?: boolean;
  /** Folds from the step's analysis; mechanical hunks fold on their own. */
  folds?: readonly DiffFold[];
  /** Fold keys the reader opened with **Show**. */
  shown?: ReadonlySet<string>;
  /** Line keys (`lineKey`) with a row of their own under them (note and thread cards). */
  inserts?: ReadonlySet<string>;
  /** Line keys whose fold opens on its own: a line comment is never hidden in a fold (F-09.7). */
  unfold?: ReadonlySet<string>;
  /**
   * Line keys shown even inside a fold, which is cut around them and `KEEP_CONTEXT` lines on each
   * side: a thread's line stays in view with its card and the lines around it, while the rest of
   * the fold stays closed (F-11.3).
   */
  keep?: ReadonlySet<string>;
}

/** Lines on each side of a kept line that its fold shows with it: git's default diff context. */
const KEEP_CONTEXT = 3;

/** Labels of mechanical hunks (docs/05 › Mechanical hunks). */
export const MECHANICAL_LABEL: Record<MechanicalReason, string> = {
  generated: 'Generated',
  whitespace: 'Whitespace only',
  packageBump: 'Package bump',
  resxKeyAdded: 'Resx key added',
};

/** A line's key on one side: `n48` (new line 48) or `o37` (old line 37). */
export const lineKey = (side: 'old' | 'new', no: number): string =>
  `${side === 'new' ? 'n' : 'o'}${String(no)}`;

interface Segment {
  lines: Line[];
  fold?: DiffFold;
  index: number;
}

/**
 * Unified rows: each hunk's header, then its lines. Split rows pair deleted and added lines by
 * position inside each run (docs/05 › Diff parsing); context lines sit on both sides. Folded
 * lines become one fold row; inserts follow the line they belong to.
 */
export function buildRows(diff: FileDiff, layout: DiffLayout, options: RowOptions = {}): DiffRow[] {
  const { note = false, headers = true, folds = [], shown, inserts, unfold, keep } = options;
  const rows: DiffRow[] = [];
  diff.hunks.forEach((hunk, h) => {
    if (hunk.fileLevel) return;
    const segments = segment(hunk, folds, keep);
    const folded = (s: Segment) =>
      s.fold !== undefined && shown?.has(foldKey(hunk, s)) !== true && !holds(s, unfold);
    if (headers && segments.some((s) => !folded(s))) {
      rows.push({ kind: 'hunk', key: `${hunk.id}#h`, hunk, first: h === 0 });
    }
    const hunkRows: DiffRow[] = [];
    for (const s of segments) {
      if (s.fold && folded(s)) {
        hunkRows.push({ kind: 'fold', key: foldKey(hunk, s), label: s.fold.label });
        continue;
      }
      const lineRows = layout === 'unified' ? unified(hunk, s) : split(hunk, s);
      for (const row of lineRows) {
        hunkRows.push(row);
        for (const at of insertKeys(row)) {
          if (inserts?.has(at)) hunkRows.push({ kind: 'insert', key: `${row.key}@${at}`, at });
        }
      }
    }
    const lastLine = hunkRows.findLast((r) => r.kind === 'line' || r.kind === 'pair');
    if (lastLine?.kind === 'line' || lastLine?.kind === 'pair') lastLine.last = true;
    rows.push(...hunkRows);
  });
  if (note) rows.push({ kind: 'note', key: 'note' });
  return rows;
}

const foldKey = (hunk: Hunk, s: Segment) => `${hunk.id}#f${String(s.index)}`;

/** A line's keys: its old side unless added, its new side unless deleted. */
function keysOf(line: Line | undefined): string[] {
  const keys: string[] = [];
  if (line?.oldNo !== undefined && line.kind !== 'add') keys.push(lineKey('old', line.oldNo));
  if (line?.newNo !== undefined) keys.push(lineKey('new', line.newNo));
  return keys;
}

function insertKeys(row: DiffRow): string[] {
  const keys: string[] = [];
  if (row.kind === 'line') keys.push(...keysOf(row.line));
  if (row.kind === 'pair') {
    if (row.left !== row.right) keys.push(...keysOf(row.left));
    keys.push(...keysOf(row.right));
  }
  return [...new Set(keys)];
}

/** The segment has a line with one of `keys`. */
function holds(s: Segment, keys: ReadonlySet<string> | undefined): boolean {
  if (!keys || keys.size === 0) return false;
  return s.lines.some((line) => keysOf(line).some((k) => keys.has(k)));
}

/**
 * Splits a hunk into runs of lines that are folded or not. A mechanical hunk is one fold; a
 * deleted line belongs where the next new-side line is; a line in `keep` is never folded, nor are
 * the lines of its fold within `KEEP_CONTEXT` of it.
 */
function segment(
  hunk: Hunk,
  folds: readonly DiffFold[],
  keep: ReadonlySet<string> | undefined,
): Segment[] {
  const mechanical: DiffFold | undefined = hunk.mechanical
    ? { newStart: 0, newEnd: 0, label: MECHANICAL_LABEL[hunk.mechanical] }
    : undefined;
  const end = hunk.newStart + Math.max(hunk.newLines - 1, 0);
  const position = (i: number): number => {
    for (let k = i; k < hunk.lines.length; k += 1) {
      const no = hunk.lines[k]?.newNo;
      if (no !== undefined) return no;
    }
    return end;
  };
  const base = hunk.lines.map((_, i) => {
    const pos = position(i);
    return mechanical ?? folds.find((f) => pos >= f.newStart && pos <= f.newEnd);
  });
  // The kept lines inside a fold, with the fold they cut.
  const kept = hunk.lines.flatMap((line, i) => {
    const fold = base[i];
    return fold && keysOf(line).some((k) => keep?.has(k)) ? [{ pos: position(i), fold }] : [];
  });
  const out: Segment[] = [];
  hunk.lines.forEach((line, i) => {
    const pos = position(i);
    const near = kept.some((k) => k.fold === base[i] && Math.abs(k.pos - pos) <= KEEP_CONTEXT);
    const fold = near ? undefined : base[i];
    const last = out.at(-1);
    if (last && last.fold === fold) last.lines.push(line);
    else out.push({ lines: [line], index: out.length, ...(fold ? { fold } : {}) });
  });
  return out;
}

function unified(hunk: Hunk, s: Segment): DiffRow[] {
  return s.lines.map((line, i) => ({
    kind: 'line',
    key: `${hunk.id}#${String(s.index)}.${String(i)}`,
    hunk,
    line,
    last: false,
  }));
}

function split(hunk: Hunk, s: Segment): DiffRow[] {
  const out: DiffRow[] = [];
  const lines = s.lines;
  let i = 0;
  const push = (left: Line | undefined, right: Line | undefined) => {
    out.push({
      kind: 'pair',
      key: `${hunk.id}#${String(s.index)}.${String(out.length)}`,
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
