import { describe, expect, it } from 'vitest';
import type { FileDiff } from '../ipc/types/FileDiff';
import type { Line } from '../ipc/types/Line';
import { buildRows, hunkRange } from './rows';

const ctx = (o: number, n: number): Line => ({
  kind: 'ctx',
  oldNo: o,
  newNo: n,
  text: 'c',
  emphasis: [],
});
const del = (o: number): Line => ({ kind: 'del', oldNo: o, text: `d${String(o)}`, emphasis: [] });
const add = (n: number): Line => ({ kind: 'add', newNo: n, text: `a${String(n)}`, emphasis: [] });

const diff: FileDiff = {
  status: 'modified',
  binary: false,
  additions: 3,
  deletions: 2,
  layer: 'app',
  lineStaging: true,
  hunks: [
    {
      id: 'h1',
      oldStart: 20,
      oldLines: 4,
      newStart: 22,
      newLines: 5,
      header: 'ProcessAsync',
      fileLevel: false,
      stagedDiffers: false,
      lines: [ctx(20, 22), del(21), del(22), add(23), add(24), add(25), ctx(23, 26)],
    },
  ],
};

describe('diff rows', () => {
  it('F-15.5 unified: a header row and one row per line', () => {
    const rows = buildRows(diff, 'unified', { note: true });
    expect(rows.map((r) => r.kind)).toEqual(['hunk', ...Array<string>(7).fill('line'), 'note']);
  });

  it('F-15.5 split pairs deletions and additions by position', () => {
    const rows = buildRows(diff, 'split');
    const pairs = rows.flatMap((r) =>
      r.kind === 'pair' ? [[r.left?.text ?? null, r.right?.text ?? null]] : [],
    );
    expect(pairs).toEqual([
      ['c', 'c'],
      ['d21', 'a23'],
      ['d22', 'a24'],
      [null, 'a25'],
      ['c', 'c'],
    ]);
  });

  it('F-09.7 a fold holding a line comment opens on its own; other folds stay folded', () => {
    const folds = [{ newStart: 23, newEnd: 25, label: 'Body' }];
    const kinds = (unfold?: ReadonlySet<string>) =>
      buildRows(diff, 'split', { headers: false, folds, unfold }).map((r) => r.kind);
    expect(kinds()).toEqual(['pair', 'fold', 'pair']);
    expect(kinds(new Set(['n26']))).toEqual(['pair', 'fold', 'pair']);
    expect(kinds(new Set(['n24']))).toEqual(Array<string>(5).fill('pair'));
    // A comment on a deleted line (old side) opens the fold the line is in.
    expect(kinds(new Set(['o22']))).toEqual(Array<string>(5).fill('pair'));
    const mechanical: FileDiff = {
      ...diff,
      hunks: diff.hunks.map((h) => ({ ...h, mechanical: 'whitespace' })),
    };
    const rows = buildRows(mechanical, 'split', { unfold: new Set(['n23']) });
    expect(rows.map((r) => r.kind)).toEqual(['hunk', ...Array<string>(5).fill('pair')]);
  });

  it('F-11.3 a thread line and 3 lines on each side are cut out of its fold; the rest stays folded', () => {
    // 20 added lines, lines 2–19 folded.
    const long: FileDiff = {
      ...diff,
      additions: 20,
      deletions: 0,
      hunks: [
        {
          id: 'h2',
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 20,
          header: 'Long',
          fileLevel: false,
          stagedDiffers: false,
          lines: Array.from({ length: 20 }, (_, i) => add(i + 1)),
        },
      ],
    };
    const folds = [{ newStart: 2, newEnd: 19, label: 'Body' }];
    const shown = (file: FileDiff, keep: ReadonlySet<string>, headers = false) =>
      buildRows(file, 'split', { headers, folds, keep }).map((r) =>
        r.kind === 'pair' ? (r.right?.newNo ?? 0) : r.kind,
      );
    expect(shown(long, new Set(['n10']))).toEqual([1, 'fold', 7, 8, 9, 10, 11, 12, 13, 'fold', 20]);
    // The window ends at the fold's edge.
    expect(shown(long, new Set(['n3']))).toEqual([1, 2, 3, 4, 5, 6, 'fold', 20]);
    // A thread outside the fold, next to it, leaves the fold whole.
    expect(shown(long, new Set(['n20']))).toEqual([1, 'fold', 20]);
    const mechanical: FileDiff = {
      ...long,
      hunks: long.hunks.map((h) => ({ ...h, mechanical: 'whitespace' })),
    };
    expect(shown(mechanical, new Set(['n10']), true)).toEqual([
      'hunk',
      'fold',
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      'fold',
    ]);
  });

  it('labels hunks by their new-side range', () => {
    const hunk = diff.hunks[0];
    if (!hunk) throw new Error('fixture');
    expect(hunkRange(hunk)).toBe('lines 22–26');
  });
});
