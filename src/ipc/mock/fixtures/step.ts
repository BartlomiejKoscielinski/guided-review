import type { FileDiff } from '../../types/FileDiff';
import type { LineSelection } from '../../types/LineSelection';
import type { Plan } from '../../types/Plan';
import type { StepView } from '../../types/StepView';
import type { Thread } from '../../types/Thread';
import { toFileDiff } from '../diff';
import { mockPlaces } from './filePlace';
import { mrFiles } from './mr';
import { gitlabPathCmp } from './planFallback';
import { onHeaders, onLine } from './threadPlace';

const QUEUE = 'src/Mobile.Infrastructure/Uploads/SqliteUploadQueue.cs';
const PAWEL = { username: 'pawel.s', name: 'Paweł S.' };
const ANNA = { username: 'anna.k', name: 'Anna K.' };
const MARTA = { username: 'marta.k', name: 'Marta K.' };
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';

/**
 * !482's three open threads from Paweł S. (the plan's "Already discussed"): two in step 2, one in
 * step 4 at `_worker.Kick()` with Marta K.'s reply (Review.dc.html).
 */
export const MOCK_THREADS: Thread[] = [
  {
    id: 'd-482-1',
    resolvable: true,
    resolved: false,
    outdated: false,
    position: {
      oldPath: QUEUE,
      newPath: QUEUE,
      newLine: 24,
      headSha: '9c41e07',
      baseSha: '5e2a9c4',
    },
    notes: [
      {
        id: 48201,
        author: PAWEL,
        body: 'Is the table created on every start? `CREATE TABLE IF NOT EXISTS` would be enough here.',
        createdAt: '2026-10-12T09:14:00.000Z',
      },
      {
        id: 48202,
        author: ANNA,
        body: 'It runs once per connection; I can move it to the migration step.',
        createdAt: '2026-10-12T10:02:00.000Z',
      },
    ],
  },
  {
    id: 'd-482-2',
    resolvable: true,
    resolved: false,
    outdated: false,
    position: {
      oldPath: QUEUE,
      newPath: QUEUE,
      newLine: 61,
      headSha: '9c41e07',
      baseSha: '5e2a9c4',
    },
    notes: [
      {
        id: 48203,
        author: PAWEL,
        body: 'What happens to a photo that keeps failing? I don’t see a limit on attempts.',
        createdAt: '2026-10-12T09:20:00.000Z',
      },
    ],
  },
  {
    id: 'd-482-3',
    resolvable: true,
    resolved: false,
    outdated: false,
    position: { oldPath: VM, newPath: VM, newLine: 48, headSha: '9c41e07', baseSha: '5e2a9c4' },
    notes: [
      {
        id: 48204,
        author: PAWEL,
        body: 'Kick() is called on the UI thread. Does the worker block anything here?',
        createdAt: '2026-10-12T09:31:00.000Z',
      },
      {
        id: 48205,
        author: MARTA,
        body: 'Kick only releases a semaphore, the upload runs in the background.',
        createdAt: '2026-10-13T06:40:00.000Z',
      },
    ],
  },
];

const path = (f: FileDiff) => f.newPath ?? f.oldPath ?? '';

/**
 * A step of !482 as `review_step` builds it (F-07.2, F-07.3): its place in `order`, the mock
 * diff's files with only the step's hunks in GitLab file order, the threads on their lines and
 * on their file headers (the mock GitLab's current `threads`, F-11.2, F-11.3).
 * `undefined` when the step isn't in `order` or the plan.
 */
export function mockStepView(
  plan: Plan,
  order: string[],
  stepId: string,
  reviewed: boolean,
  fallback: boolean,
  threads: readonly Thread[] = MOCK_THREADS,
): StepView | undefined {
  const index = order.indexOf(stepId);
  const step = plan.steps.find((s) => s.id === stepId);
  if (index < 0 || !step) return undefined;

  const files = stepFiles(step);
  const prev = order[index - 1];
  const next = order[index + 1];
  return {
    step: structuredClone(step),
    number: index + 1,
    total: order.length,
    ...(prev === undefined ? {} : { prev }),
    ...(next === undefined ? {} : { next }),
    files,
    threads: structuredClone(threads.filter((t) => files.some((f) => onLine(f, t)))),
    fileThreads: structuredClone(onHeaders(plan, order, stepId, threads)),
    reviewed,
    fallback,
    places: mockPlaces(plan, order, stepId),
  };
}

/** The files of a step with only the step's hunks, in GitLab's order. */
export function stepFiles(step: Plan['steps'][number]): FileDiff[] {
  const files: FileDiff[] = [];
  for (const file of mrFiles()) {
    const diff = toFileDiff(file);
    const hunks = diff.hunks.filter((h) => step.hunkIds.includes(h.id));
    if (hunks.length === 0) continue;
    if (hunks.length === diff.hunks.length) {
      files.push(diff);
      continue;
    }
    const count = (kind: 'add' | 'del') =>
      hunks.flatMap((h) => h.lines).filter((l) => l.kind === kind).length;
    files.push({ ...diff, hunks, additions: count('add'), deletions: count('del') });
  }
  files.sort((a, b) => gitlabPathCmp(path(a), path(b)));
  return files;
}

/**
 * Some of the selected lines are in the step's hunks, as the core's `LineSelection::lines`
 * reads them: the file by its new or old path, the side's line numbers in the range.
 */
export function selectionInStep(files: FileDiff[], selection: LineSelection): boolean {
  const low = Math.min(selection.start, selection.end);
  const high = Math.max(selection.start, selection.end);
  return files
    .filter((f) => f.newPath === selection.file || f.oldPath === selection.file)
    .flatMap((f) => f.hunks.flatMap((h) => h.lines))
    .some((l) => {
      const no =
        selection.side === 'new'
          ? l.kind === 'del'
            ? undefined
            : l.newNo
          : l.kind === 'add'
            ? undefined
            : l.oldNo;
      return no !== undefined && no >= low && no <= high;
    });
}
