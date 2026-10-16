import { describe, expect, it } from 'vitest';
import type { FileDiff } from '../ipc/types/FileDiff';
import type { Line } from '../ipc/types/Line';
import { ignoreWhitespace } from './whitespace';

// F-08.5 Ignore whitespace on the S-04 file bar (M4 decision 5): display only, like `git diff -w`.
// A removed and an added line of the same change that are equal once whitespace is removed show as
// one unchanged line with both line numbers; a real change is kept; hunks keep their IDs.

const ctx = (o: number, n: number, text: string): Line => ({
  kind: 'ctx',
  oldNo: o,
  newNo: n,
  text,
  emphasis: [],
});
const del = (o: number, text: string): Line => ({
  kind: 'del',
  oldNo: o,
  text,
  emphasis: [{ start: 0, end: 1 }],
});
const add = (n: number, text: string): Line => ({
  kind: 'add',
  newNo: n,
  text,
  emphasis: [{ start: 0, end: 1 }],
});

const file = (lines: Line[]): FileDiff => ({
  newPath: 'src/Mobile.App/ViewModels/Sample.cs',
  oldPath: 'src/Mobile.App/ViewModels/Sample.cs',
  status: 'modified',
  binary: false,
  additions: lines.filter((l) => l.kind === 'add').length,
  deletions: lines.filter((l) => l.kind === 'del').length,
  layer: 'app',
  lineStaging: false,
  hunks: [
    {
      id: 'src/Mobile.App/ViewModels/Sample.cs#h1',
      oldStart: 10,
      oldLines: lines.filter((l) => l.kind !== 'add').length,
      newStart: 20,
      newLines: lines.filter((l) => l.kind !== 'del').length,
      header: 'Sample',
      fileLevel: false,
      stagedDiffers: false,
      lines,
    },
  ],
});

const shown = (lines: Line[]): Line[] => ignoreWhitespace(file(lines)).hunks[0]?.lines ?? [];

describe('Ignore whitespace (F-08.5, M4 decision 5)', () => {
  it.each([
    ['an indentation change', '    return queue;', '        return queue;'],
    ['trailing spaces', 'var count = 1;', 'var count = 1;   '],
    ['tabs instead of spaces', '    Kick();', '\tKick();'],
    ['spaces inside the line', 'if (pending > 0)', 'if(pending>0)'],
  ])(
    'F-08.5 %s shows as one unchanged line with both line numbers and the new text',
    (_case, before, after) => {
      expect(shown([ctx(10, 20, '{'), del(11, before), add(21, after), ctx(12, 22, '}')])).toEqual([
        ctx(10, 20, '{'),
        ctx(11, 21, after),
        ctx(12, 22, '}'),
      ]);
    },
  );

  it('F-08.5 a real change is kept as a removed and an added line', () => {
    const lines = [
      ctx(10, 20, '{'),
      del(11, 'var count = 1;'),
      add(21, 'var count = 2;'),
      ctx(12, 22, '}'),
    ];
    expect(shown(lines)).toEqual(lines);
  });

  it('F-08.5 in one change only the whitespace pairs turn unchanged, in the order of both sides', () => {
    expect(
      shown([
        del(10, 'Upload(bytes);'),
        del(11, '  Kick();'),
        add(20, 'Enqueue(bytes);'),
        add(21, '    Kick();'),
      ]),
    ).toEqual([del(10, 'Upload(bytes);'), add(20, 'Enqueue(bytes);'), ctx(11, 21, '    Kick();')]);
  });

  it('F-08.5 pairs are found like git diff -w, not only line by line', () => {
    // The first removed line has no partner; the second one is the added line re-indented.
    expect(
      shown([del(10, 'Upload(bytes);'), del(11, '  Kick();'), add(20, '    Kick();')]),
    ).toEqual([del(10, 'Upload(bytes);'), ctx(11, 20, '    Kick();')]);
  });

  it('F-08.5 a line without a removed partner stays added, a blank one too', () => {
    const lines = [ctx(10, 20, '{'), add(21, ''), add(22, '    Kick();'), ctx(11, 23, '}')];
    expect(shown(lines)).toEqual(lines);
  });

  it('F-08.5 lines on both sides of an unchanged line do not pair up', () => {
    const lines = [del(10, '  Kick();'), ctx(11, 20, 'Save();'), add(21, '    Kick();')];
    expect(shown(lines)).toEqual(lines);
  });

  it('F-08.5 hunks keep their IDs and ranges, and the input is not changed', () => {
    const input = file([del(11, '    return queue;'), add(21, '        return queue;')]);
    const copy = structuredClone(input);
    const out = ignoreWhitespace(input);
    expect(out.hunks.map((h) => [h.id, h.oldStart, h.oldLines, h.newStart, h.newLines])).toEqual([
      ['src/Mobile.App/ViewModels/Sample.cs#h1', 10, 1, 20, 1],
    ]);
    expect(out.hunks[0]?.lines).toEqual([ctx(11, 21, '        return queue;')]);
    expect(input).toEqual(copy);
  });
});
