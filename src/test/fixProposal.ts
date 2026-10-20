import { vi } from 'vitest';
import type { IpcClient } from '../ipc/client';
import { IpcError } from '../ipc/errors';
import type { ErrorCode } from '../ipc/types/ErrorCode';
import type { FixProposal } from '../ipc/types/FixProposal';

// Test doubles for F-25.3: a `fixPropose` the test settles by hand, so the busy line, the proposal
// and the failures can be looked at one by one. Contract: `fixPropose(target, onEvent)` with
// `target = { task, sessionId, findingId } | { task, sessionId, draftId }`, `claudeCancel(task)`.

export const VM_PATH = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
export const VM_NAME = 'DeliveryPhotoViewModel.cs';
export const SENTENCE = 'Refreshes PendingCount from the queue after each upload.';

/** A proposal that adds one line and takes one out. */
export function proposalOf(file: string = VM_PATH, explanation: string = SENTENCE): FixProposal {
  return {
    id: 'fix-1',
    file,
    explanation,
    hunks: [
      {
        id: 'h1',
        oldStart: 48,
        oldLines: 3,
        newStart: 48,
        newLines: 3,
        header: 'SendPhotoAsync',
        fileLevel: false,
        stagedDiffers: false,
        lines: [
          { kind: 'ctx', oldNo: 48, newNo: 48, text: '        _worker.Kick();', emphasis: [] },
          {
            kind: 'del',
            oldNo: 49,
            text: '        PendingCount = await _queue.CountAsync();',
            emphasis: [],
          },
          {
            kind: 'add',
            newNo: 49,
            text: '        await RefreshPendingAsync();',
            emphasis: [],
          },
          { kind: 'ctx', oldNo: 50, newNo: 50, text: '        StatusText = "";', emphasis: [] },
        ],
      },
    ],
  };
}

export interface FixRun {
  fixPropose: ReturnType<typeof vi.fn<IpcClient['fixPropose']>>;
  claudeCancel: ReturnType<typeof vi.fn<IpcClient['claudeCancel']>>;
  /** Answers the run in progress with a proposal (also tells the listener `done`). */
  finish: (proposal: FixProposal) => Promise<void>;
  /** Ends the run in progress with an error of the core. */
  fail: (code: ErrorCode, message: string) => Promise<void>;
}

/**
 * `fixPropose` that stays pending until `finish` or `fail`, and `claudeCancel` that ends the
 * pending run with CANCELLED the way the core does.
 */
export function manualFix(): FixRun {
  let settle: { resolve: (p: FixProposal) => void; reject: (e: IpcError) => void } | null = null;
  const fixPropose = vi.fn<IpcClient['fixPropose']>(
    (_target, onEvent) =>
      new Promise<FixProposal>((resolve, reject) => {
        onEvent({ kind: 'started' });
        settle = {
          resolve: (p) => {
            onEvent({ kind: 'done', result: p });
            resolve(p);
          },
          reject,
        };
      }),
  );
  const claudeCancel = vi.fn<IpcClient['claudeCancel']>(() => {
    settle?.reject(new IpcError({ code: 'CANCELLED', message: 'Cancelled.', retryable: false }));
    return Promise.resolve();
  });
  const later = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    fixPropose,
    claudeCancel,
    finish: async (proposal) => {
      settle?.resolve(proposal);
      await later();
    },
    fail: async (code, message) => {
      settle?.reject(new IpcError({ code, message, retryable: code === 'CLAUDE_LIMITED' }));
      await later();
    },
  };
}
