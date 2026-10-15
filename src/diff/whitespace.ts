import type { FileDiff } from '../ipc/types/FileDiff';
import type { Line } from '../ipc/types/Line';

/** Above this many cells of the pairing table the middle of a change keeps its lines as they are. */
const MAX_CELLS = 4_000_000;

/** A line's text without any whitespace: what `git diff -w` compares. */
const squash = (text: string): string => text.replace(/\s+/g, '');

/**
 * Ignore whitespace on the S-04 file bar (F-08.5, M4 decision 5), display only: inside each change
 * (the removed and added lines between two unchanged lines) a removed and an added line that are
 * equal once whitespace is removed show as one unchanged line with both numbers and the new text.
 * Pairs are found like `git diff -w` (longest common subsequence, in order). Hunk IDs, ranges and
 * the file's `+/−` stay, so steps, notes and coverage are untouched; the input is not changed.
 */
export function ignoreWhitespace(file: FileDiff): FileDiff {
  const hunks = file.hunks.map((hunk) => {
    const lines = hunkLines(hunk.lines);
    return lines === hunk.lines ? hunk : { ...hunk, lines };
  });
  return hunks.some((hunk, i) => hunk !== file.hunks[i]) ? { ...file, hunks } : file;
}

/** The hunk's lines with whitespace-only pairs merged; the same array when nothing pairs. */
function hunkLines(lines: Line[]): Line[] {
  const runs: Line[][] = [];
  let run: Line[] = [];
  for (const line of lines) {
    if (line.kind === 'ctx') {
      if (run.length > 0) runs.push(run);
      runs.push([line]);
      run = [];
    } else {
      run.push(line);
    }
  }
  if (run.length > 0) runs.push(run);
  const merged = runs.map(pairRun);
  return merged.some((part, i) => part !== runs[i]) ? merged.flat() : lines;
}

/**
 * One change: between two pairs the removed lines come first, then the added ones, then the pair
 * as an unchanged line. The same array when nothing pairs.
 */
function pairRun(run: Line[]): Line[] {
  const dels = run.filter((l) => l.kind === 'del');
  const adds = run.filter((l) => l.kind === 'add');
  if (dels.length === 0 || adds.length === 0) return run;
  const pairs = matches(
    dels.map((l) => squash(l.text)),
    adds.map((l) => squash(l.text)),
  );
  if (pairs.length === 0) return run;
  const out: Line[] = [];
  let d = 0;
  let a = 0;
  for (const [di, ai] of pairs) {
    out.push(...dels.slice(d, di), ...adds.slice(a, ai));
    const removed = dels[di];
    const added = adds[ai];
    if (removed && added) {
      out.push({
        kind: 'ctx',
        oldNo: removed.oldNo,
        newNo: added.newNo,
        text: added.text,
        emphasis: [],
      });
    }
    d = di + 1;
    a = ai + 1;
  }
  out.push(...dels.slice(d), ...adds.slice(a));
  return out;
}

/** Index pairs of a longest common subsequence of `a` and `b`, in order. */
function matches(a: string[], b: string[]): [number, number][] {
  const head: [number, number][] = [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    head.push([start, start]);
    start += 1;
  }
  const tail: [number, number][] = [];
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
    tail.unshift([endA, endB]);
  }
  return [...head, ...middle(a, b, start, endA, endB), ...tail];
}

/** The LCS of `a[start..endA)` and `b[start..endB)` from a table of suffix lengths. */
function middle(
  a: string[],
  b: string[],
  start: number,
  endA: number,
  endB: number,
): [number, number][] {
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0 || n * m > MAX_CELLS) return [];
  const width = m + 1;
  const len = new Uint32Array((n + 1) * width);
  const at = (i: number, j: number): number => len[i * width + j] ?? 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      len[i * width + j] =
        a[start + i] === b[start + j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      pairs.push([start + i, start + j]);
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}
