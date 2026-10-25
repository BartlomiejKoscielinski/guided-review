import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { FixProposal } from '../types/FixProposal';
import type { FixTarget } from '../types/FixTarget';
import type { FixThreadTarget } from '../types/FixThreadTarget';
import type { Hunk } from '../types/Hunk';
import type { Source } from '../types/Source';
import { noteKey } from './review';
import type { SessionData } from './session-data';

/** How long the mock's Claude edits the file (Author.dc.html's timer); not scaled by latency. */
export const MOCK_FIX_MS = 1300;

/** The core's refusal on a teammate's MR (`fix/eligibility.rs`). */
const NOT_ALLOWED = 'Fix with Claude is only available on your own code.';

/** Accept of a proposal that was accepted, discarded or never made (`fix/accept.rs`). */
const NOT_OPEN = 'This fix is no longer open.';

type FixClient = Pick<IpcClient, 'fixPropose' | 'fixProposeThread' | 'fixAccept' | 'fixDiscard'>;

/** The file and line of a thread of my MR, or the core's refusal (`commands/fix_thread.rs`). */
export type ThreadOf = (target: FixThreadTarget) => Promise<{ file: string; line: number }>;

/** UploadWorker.cs at Marta K.'s line 46 (Author.dc.html `patch`): exponential backoff, capped. */
function backoffHunk(): Hunk {
  const delay =
    '                var delay = TimeSpan.FromSeconds(Math.Min(Math.Pow(2, attempt), 60));';
  return {
    id: 'fix-upload-worker-46',
    oldStart: 45,
    oldLines: 3,
    newStart: 45,
    newLines: 4,
    header: '',
    fileLevel: false,
    stagedDiffers: false,
    lines: [
      { kind: 'ctx', oldNo: 45, newNo: 45, text: '            {', emphasis: [] },
      {
        kind: 'del',
        oldNo: 46,
        text: '                await Task.Delay(1000 * attempt, ct);',
        emphasis: [],
      },
      { kind: 'add', newNo: 46, text: delay, emphasis: [] },
      {
        kind: 'add',
        newNo: 47,
        text: '                await Task.Delay(delay, ct);',
        emphasis: [],
      },
      { kind: 'ctx', oldNo: 47, newNo: 48, text: '            }', emphasis: [] },
    ],
  };
}

const isUploadWorker = (file: string) => file.endsWith('UploadWorker.cs');

/** One edit at the note's line: a line taken out and a line put in, with context around. */
function hunkAt(file: string, line: number): Hunk {
  const at = Math.max(line, 2);
  const counter = file.endsWith('DeliveryPhotoViewModel.cs');
  const before = counter ? '        _worker.Kick();' : '        // before';
  const removed = counter
    ? '        PendingCount = await _queue.CountAsync();'
    : '        Process(item);';
  const added = counter
    ? '        await RefreshPendingAsync();'
    : '        await ProcessAsync(item);';
  const after = counter ? '        StatusText = "";' : '        // after';
  return {
    id: `fix-${file}-${String(at)}`,
    oldStart: at - 1,
    oldLines: 3,
    newStart: at - 1,
    newLines: 3,
    header: '',
    fileLevel: false,
    stagedDiffers: false,
    lines: [
      { kind: 'ctx', oldNo: at - 1, newNo: at - 1, text: before, emphasis: [] },
      { kind: 'del', oldNo: at, text: removed, emphasis: [] },
      { kind: 'add', newNo: at, text: added, emphasis: [] },
      { kind: 'ctx', oldNo: at + 1, newNo: at + 1, text: after, emphasis: [] },
    ],
  };
}

const BACKOFF =
  'Doubles the wait after each attempt (2, 4, 8 … s) and caps it at 60 s, as Marta asked.';

const sentenceFor = (file: string) =>
  file.endsWith('DeliveryPhotoViewModel.cs')
    ? 'Refreshes PendingCount from the queue after each upload.'
    : 'Awaits the processing of each item before the next one starts.';

/**
 * Fix with Claude in the mock (F-25.3), as `fix_propose`: a teammate's MR is refused before any
 * event (F-25.1; the mock's MRs are teammates'), then `started`, about 1.3 s, and `done` with a
 * proposal for the note's one file. `cancel(task)` ends a run with CANCELLED. The proposal stays
 * open until `fixAccept` or `fixDiscard` (F-25.4).
 */
export function createFixBackend(
  data: { data: SessionData },
  sourceOf: (sessionId: string) => Source | undefined,
  threadOf: ThreadOf = () =>
    Promise.reject(
      new IpcError({ code: 'FIX_NOT_ALLOWED', message: NOT_ALLOWED, retryable: false }),
    ),
): FixClient & { cancel: (task: string) => boolean } {
  const running = new Map<string, () => void>();
  /** The proposals with an edit, waiting for Accept or Discard (`fix/proposals.rs`). */
  const open = new Set<string>();
  let next = 1;

  const noteOf = (target: FixTarget): { file: string; line: number } => {
    if (target.draftId !== undefined) {
      const draft = data.data.drafts.find(
        (d) => d.id === target.draftId && d.sessionId === target.sessionId,
      );
      if (!draft?.position)
        throw new IpcError({
          code: 'INVALID_INPUT',
          message: 'This note has no file to fix.',
          retryable: false,
        });
      return { file: draft.position.file, line: draft.position.line };
    }
    const stored = data.data.notes[noteKey(target.sessionId, target.findingId ?? '')];
    if (!stored)
      throw new IpcError({ code: 'INVALID_INPUT', message: 'Unknown note.', retryable: false });
    return { file: stored.finding.file, line: stored.finding.line };
  };

  /** `started`, about 1.3 s of Claude, then `done` with the proposal for the note's one file. */
  const propose = async (
    task: string,
    note: { file: string; line: number },
    onEvent: Parameters<IpcClient['fixPropose']>[1],
    /** A thread of my MR (S-10): Marta K.'s UploadWorker.cs fix is Author.dc.html's proposal. */
    thread = false,
  ): Promise<FixProposal> => {
    const backoff = thread && isUploadWorker(note.file);
    onEvent({ kind: 'started' });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        running.delete(task);
        resolve();
      }, MOCK_FIX_MS);
      running.set(task, () => {
        clearTimeout(timer);
        running.delete(task);
        reject(new IpcError({ code: 'CANCELLED', message: 'Cancelled.', retryable: false }));
      });
    });
    const result: FixProposal = {
      id: `mock-fix-${String(next++)}`,
      file: note.file,
      hunks: [backoff ? backoffHunk() : hunkAt(note.file, note.line)],
      explanation: backoff ? BACKOFF : sentenceFor(note.file),
    };
    open.add(result.id);
    onEvent({ kind: 'done', result });
    return structuredClone(result);
  };

  return {
    fixPropose: async (target, onEvent) => {
      await Promise.resolve();
      const source = sourceOf(target.sessionId);
      if (!source || source.kind === 'mr')
        throw new IpcError({ code: 'FIX_NOT_ALLOWED', message: NOT_ALLOWED, retryable: false });
      return propose(target.task, noteOf(target), onEvent);
    },
    // F-25.1 on S-10: my MR on its source branch only, a change thread on a file only.
    fixProposeThread: async (target, onEvent) =>
      propose(target.task, await threadOf(target), onEvent, true),
    // F-25.4: the mock has no file to change behind the app's back, so Accept never goes stale.
    fixAccept: async (id) => {
      await Promise.resolve();
      if (!open.delete(id))
        throw new IpcError({ code: 'INVALID_INPUT', message: NOT_OPEN, retryable: false });
    },
    fixDiscard: async (id) => {
      await Promise.resolve();
      open.delete(id);
    },
    cancel: (task) => {
      const stop = running.get(task);
      stop?.();
      return stop !== undefined;
    },
  };
}
