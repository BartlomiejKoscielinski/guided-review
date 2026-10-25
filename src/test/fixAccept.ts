import { vi } from 'vitest';
import type { IpcClient } from '../ipc/client';
import { IpcError } from '../ipc/errors';
import type { ErrorCode } from '../ipc/types/ErrorCode';

// Test doubles for F-25.4: `fixAccept(id)` that stays pending until the test settles it, so the
// card can be looked at while Accept is in flight, and `fixDiscard(id)`. Contract (docs/04 › fix):
// `fixAccept(id: string): Promise<void>`, `fixDiscard(id: string): Promise<void>`; `id` is the
// proposal's `FixProposal.id`.

export const STALE = 'The file changed while Claude worked. Run it again.';
export const APPLIED = 'Applied to your working copy.';

export interface AcceptRun {
  fixAccept: ReturnType<typeof vi.fn<IpcClient['fixAccept']>>;
  fixDiscard: ReturnType<typeof vi.fn<IpcClient['fixDiscard']>>;
  /** Accept succeeded: the core wrote the file. */
  succeed: () => Promise<void>;
  /** Accept failed with an error of the core. */
  fail: (code: ErrorCode, message: string) => Promise<void>;
}

/** `fixAccept` that stays pending until `succeed` or `fail`; `fixDiscard` answers at once. */
export function manualAccept(): AcceptRun {
  let settle: { resolve: () => void; reject: (e: IpcError) => void } | null = null;
  const fixAccept = vi.fn<IpcClient['fixAccept']>(
    () =>
      new Promise<void>((resolve, reject) => {
        settle = { resolve, reject };
      }),
  );
  const fixDiscard = vi.fn<IpcClient['fixDiscard']>(() => Promise.resolve());
  const later = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    fixAccept,
    fixDiscard,
    succeed: async () => {
      settle?.resolve();
      await later();
    },
    fail: async (code, message) => {
      settle?.reject(new IpcError({ code, message, retryable: false }));
      await later();
    },
  };
}
