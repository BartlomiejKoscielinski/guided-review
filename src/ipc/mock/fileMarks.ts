import { IpcError } from '../errors';
import type { Plan } from '../types/Plan';
import { stepFiles } from './fixtures/step';
import { stateOf, type SessionData } from './session-data';

/**
 * File marks of the mock backend (F-07.10), as `review/progress.rs` keeps them: the files of a
 * step marked on their own are kept with the session's state (`StoredState.files`), the step's
 * reviewed flag stays in `SessionData.marks` and is set once all its files are marked. A step
 * flagged before file marks existed counts as all its files reviewed.
 */

type PlanStep = Plan['steps'][number];

/** The paths of the step's files (new path, else old path), in the diff's order. */
const pathsOf = (step: PlanStep): string[] =>
  stepFiles(step).map((f) => f.newPath ?? f.oldPath ?? '');

/** Marks or unmarks one file of `step`; the step is reviewed when all its files are. */
export function markFile(
  data: SessionData,
  sessionId: string,
  step: PlanStep,
  file: string,
  reviewed: boolean,
): void {
  const paths = pathsOf(step);
  if (!paths.includes(file)) {
    throw new IpcError({
      code: 'INVALID_INPUT',
      message: 'The file is not in the step.',
      retryable: false,
    });
  }
  const steps = new Set(data.marks[sessionId] ?? []);
  const state = stateOf(data, sessionId);
  const files = (state.files ??= {});
  const before = steps.has(step.id) ? paths : (files[step.id] ?? []);
  const after = new Set(before.filter((p) => p !== file));
  if (reviewed) after.add(file);
  files[step.id] = paths.filter((p) => after.has(p));
  if (paths.every((p) => after.has(p))) steps.add(step.id);
  else steps.delete(step.id);
  data.marks[sessionId] = [...steps];
}

/** Mark reviewed's undo takes back every file mark of the step. */
export function unmarkFiles(data: SessionData, sessionId: string, stepId: string): void {
  const files = data.states[sessionId]?.files;
  if (files) Reflect.deleteProperty(files, stepId);
}

/** `SessionState.reviewedFiles`: the files marked on their own, per step that has any. */
export function reviewedFilesOf(data: SessionData, sessionId: string): Record<string, string[]> {
  const files = data.states[sessionId]?.files ?? {};
  return Object.fromEntries(
    Object.entries(files)
      .filter(([, paths]) => paths.length > 0)
      .map(([step, paths]) => [step, [...paths]]),
  );
}
