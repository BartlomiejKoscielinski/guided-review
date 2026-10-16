import type { FilePlace } from '../../types/FilePlace';
import type { PlacedFile } from '../../types/PlacedFile';
import type { Plan } from '../../types/Plan';
import { toFileDiff } from '../diff';
import { mrFiles } from './mr';

interface HunkRef {
  id: string;
  file: string;
}

/**
 * The place of `file` on step `current` as the core's `file_place::place` computes it (M4
 * decision 8): the current step when it touches the file, else the first step in `order` that
 * does, else skim when a skim group does, else outside.
 */
export function placeOf(
  plan: Plan,
  hunks: HunkRef[],
  order: string[],
  current: string,
  file: string,
): FilePlace {
  const ids = hunks.filter((h) => h.file === file).map((h) => h.id);
  if (ids.length === 0) return { kind: 'outside' };
  const touches = (stepId: string) =>
    plan.steps.find((s) => s.id === stepId)?.hunkIds.some((h) => ids.includes(h)) === true;
  const index = order.indexOf(current);
  if (index >= 0 && touches(current)) return { kind: 'step', number: index + 1 };
  const first = order.findIndex(touches);
  if (first >= 0) return { kind: 'step', number: first + 1 };
  const skim = plan.skim.some((g) => g.hunkIds.some((h) => ids.includes(h)));
  return skim ? { kind: 'skim' } : { kind: 'outside' };
}

/** Every file of the mock diff with its place on step `current` (`StepView.places`). */
export function mockPlaces(plan: Plan, order: string[], current: string): PlacedFile[] {
  const hunks = mrFiles().flatMap((f) => {
    const diff = toFileDiff(f);
    const file = diff.newPath ?? diff.oldPath ?? '';
    return diff.hunks.map((h) => ({ id: h.id, file }));
  });
  const files = [...new Set(hunks.map((h) => h.file))];
  return files.map((file) => ({ file, place: placeOf(plan, hunks, order, current, file) }));
}
