import type { Thread } from '../types/Thread';
import type { ThreadHint } from '../types/ThreadHint';

/**
 * F-13.3 in the mock backend: how the mock stands in for Claude's thread check. A candidate is
 * what `claude/tasks/thread_check_inputs.rs` checks: an open (resolvable, not resolved) diff
 * thread written on another version than the reviewed one (a commit id, as
 * `review/thread_place.rs` reads it). Of those, a thread written on 3b8d1f0 (the version the
 * mock's outdated threads are written on) is addressed by commit a91f2c0, "index added"
 * (SummaryDesk.dc.html); threads written on any other version are not found addressed.
 */

/** The version every MR session of the mock reviews (`fixtures/step.ts`). */
export const MOCK_REVIEWED_HEAD = '9c41e07';
/** Where the mock's outdated threads were written. */
export const MOCK_THREAD_WRITTEN_ON = '3b8d1f0';
/** The later commit that addresses them, as the core answers it: the full id. */
export const MOCK_ADDRESSING_COMMIT = 'a91f2c0d4e8b5f36c17a09b2d3e4f5a6b7c8d9e0';
export const MOCK_THREAD_HINT = 'index added';
/** How long the mock checks, so "Claude is checking the threads…" is visible. */
export const MOCK_THREAD_CHECK_MS = 1100;

const SHA = /^[0-9a-f]{7,40}$/i;

/** An open thread written on another version than `head` (`is_candidate` in the core). */
export function isThreadCheckCandidate(thread: Thread, head = MOCK_REVIEWED_HEAD): boolean {
  const written = thread.position?.headSha;
  return (
    thread.resolvable &&
    !thread.resolved &&
    written !== undefined &&
    SHA.test(written) &&
    written.toLowerCase() !== head.toLowerCase()
  );
}

/** The hints the mock's Claude gives for `threads`, in their order. */
export function mockThreadHints(threads: Thread[]): ThreadHint[] {
  return threads
    .filter(
      (t) =>
        isThreadCheckCandidate(t) && t.position?.headSha.toLowerCase() === MOCK_THREAD_WRITTEN_ON,
    )
    .map((t) => ({
      discussionId: t.id,
      commit: MOCK_ADDRESSING_COMMIT,
      hint: MOCK_THREAD_HINT,
    }));
}
