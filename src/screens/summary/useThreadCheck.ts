import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { CLAUDE_STATUS_KEY } from '../../ipc/hooks/useClaude';
import { useIpc } from '../../ipc/IpcContext';
import type { Thread } from '../../ipc/types/Thread';
import type { ThreadHint } from '../../ipc/types/ThreadHint';

/** Claude checks (`running`), couldn't check (`failed`, with Retry), or nothing is going on. */
export type ThreadCheckPhase = 'idle' | 'running' | 'failed';

export interface ThreadCheck {
  phase: ThreadCheckPhase;
  /** Claude's last answer by discussion id; null before the first answer and after a failure. */
  hints: ReadonlyMap<string, ThreadHint> | null;
  /** Check with Claude and Retry: one run at a time. */
  check: () => void;
}

interface State {
  sessionId: string;
  phase: ThreadCheckPhase;
  hints: ReadonlyMap<string, ThreadHint> | null;
}

/**
 * An open thread written on an older version than the reviewed one: what Claude can find
 * addressed by a later commit (`is_candidate` in `claude/tasks/thread_check_inputs.rs`).
 */
export const writtenOnOlderVersion = (thread: Thread): boolean =>
  thread.resolvable && !thread.resolved && thread.outdated;

/**
 * Check with Claude on S-05's Threads tab (F-13.3, M5 decision 12): `claude_thread_check` runs
 * only on the reviewer's click, never on opening the screen or the tab. The screen, not the tab,
 * holds this hook, so a run outlives a visit to Drafts and its hints are there on return. A new
 * answer replaces the last one; the core answers a repeat for the same head and threads from its
 * cache. Claude resolves nothing: the hints only label the rows.
 */
export function useThreadCheck(sessionId: string): ThreadCheck {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>({ sessionId, phase: 'idle', hints: null });
  /** The session a run is going on for; null when none is. */
  const running = useRef<string | null>(null);

  // Another session in the same screen starts from nothing (its own run, its own answer).
  const own: State =
    state.sessionId === sessionId ? state : { sessionId, phase: 'idle', hints: null };

  const check = () => {
    if (running.current !== null) return;
    const session = sessionId;
    running.current = session;
    setState({ sessionId: session, phase: 'running', hints: own.hints });
    const settle = (next: State) => {
      running.current = null;
      setState(next);
      // The status follows the task result (F-18.1, F-18.7).
      void queryClient.invalidateQueries({ queryKey: CLAUDE_STATUS_KEY });
    };
    void ipc
      .claudeThreadCheck(session, () => undefined)
      .then(
        (result) => {
          const hints = new Map(result.hints.map((hint) => [hint.discussionId, hint]));
          settle({ sessionId: session, phase: 'idle', hints });
        },
        () => {
          settle({ sessionId: session, phase: 'failed', hints: null });
        },
      );
  };

  return { phase: own.phase, hints: own.hints, check };
}
