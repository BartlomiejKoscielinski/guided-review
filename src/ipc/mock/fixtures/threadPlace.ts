import type { FileDiff } from '../../types/FileDiff';
import type { Hunk } from '../../types/Hunk';
import type { Plan } from '../../types/Plan';
import type { Thread } from '../../types/Thread';
import { toFileDiff } from '../diff';
import { mrFiles } from './mr';

/**
 * Where a thread shows in the steps, as `review/thread_place.rs` (F-11.3, M5 decision 4): an
 * outdated thread on the line the core placed it on (`placedLine`, the side of its position), a
 * current one on its position's line; a thread no step shows on a line is on the file header of
 * the first step in the reader's order with its file; a file no step shows keeps it out of every
 * step (S-05 lists it).
 */

/** The side and line a thread shows on, or null for a file header. */
function lineOf(thread: Thread): { newSide: boolean; line: number } | null {
  const pos = thread.position;
  if (!pos) return null;
  const newSide = pos.newLine !== undefined;
  const line = thread.outdated ? thread.placedLine : (pos.newLine ?? pos.oldLine);
  return line === undefined ? null : { newSide, line };
}

function inside(hunk: Hunk, at: { newSide: boolean; line: number }): boolean {
  const [start, count] = at.newSide
    ? [hunk.newStart, hunk.newLines]
    : [hunk.oldStart, hunk.oldLines];
  return at.line >= start && at.line < start + count;
}

function sameFile(file: FileDiff, thread: Thread): boolean {
  const pos = thread.position;
  return pos !== undefined && (file.newPath === pos.newPath || file.oldPath === pos.oldPath);
}

/** The thread shows on a line inside one of the file's hunks. */
export function onLine(file: FileDiff, thread: Thread): boolean {
  if (!sameFile(file, thread)) return false;
  const at = lineOf(thread);
  return at !== null && file.hunks.some((h) => inside(h, at));
}

/** The threads on the file headers of step `stepId`, in the threads' order. */
export function onHeaders(
  plan: Plan,
  order: readonly string[],
  stepId: string,
  threads: readonly Thread[],
): Thread[] {
  const files = mrFiles().map((f) => toFileDiff(f));
  const shown = new Set(plan.steps.flatMap((s) => s.hunkIds));
  const firstStep = (file: FileDiff) =>
    order.find((id) =>
      plan.steps.some((s) => s.id === id && file.hunks.some((h) => s.hunkIds.includes(h.id))),
    );
  return threads.filter((thread) => {
    const file = files.find((f) => sameFile(f, thread));
    if (!file) return false;
    const at = lineOf(thread);
    const onStepLine = at !== null && file.hunks.some((h) => shown.has(h.id) && inside(h, at));
    return !onStepLine && firstStep(file) === stepId;
  });
}
