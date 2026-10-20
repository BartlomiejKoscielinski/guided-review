import { useIpc } from '../../ipc/IpcContext';
import { IpcError } from '../../ipc/errors';
import { fixKey, useFixStore, type OpenFix } from '../../state/fix';
import type { FixCardState } from './fixState';

/** The tooltip of Fix with Claude while another fix runs or waits (M7 decision 4). */
export const FINISH_FIRST = 'Finish the open fix first.';

let runs = 0;

/** A fix that keeps the others from starting: running or waiting, not one already applied. */
const busy = (open: OpenFix | null) => open !== null && open.state.phase !== 'applied';

export interface UseFix {
  /** This note's card; null when it has none. */
  state: FixCardState | null;
  /** A fix runs or waits (this note's or another's): Fix with Claude is disabled. */
  blocked: boolean;
  /** Starts the fix of this note on `file`. */
  start: () => void;
  cancel: () => void;
  /** Closes the card (a failed run, no change). */
  close: () => void;
  /** Accept: writes the proposal into the working copy (F-25.4). */
  accept: () => void;
  /** Discard: drops the proposal and closes the card at once (F-25.4). */
  discard: () => void;
}

/**
 * Fix with Claude on one note (F-25.3): `fixPropose` with the note as its target, the card's
 * state in `useFixStore` so the run outlives the card. Cancel ends the run with `claudeCancel`
 * and shows no error. Accept keeps the proposal until the core answers: the applied line on
 * success, the core's message on the card when refused; Discard closes the card at once. An
 * applied line does not block the next fix, whose run replaces it.
 */
export function useFix(
  sessionId: string,
  note: { findingId: string } | { draftId: string },
  file: string,
): UseFix {
  const ipc = useIpc();
  const key = fixKey(sessionId, note);
  const open = useFixStore((s) => s.open);
  const blocked = useFixStore((s) => busy(s.open));
  const mine = open?.key === key ? open : null;

  const start = () => {
    if (busy(useFixStore.getState().open)) return;
    runs += 1;
    const task = `fix-${String(Date.now())}-${String(runs)}`;
    const { setOpen, settle } = useFixStore.getState();
    setOpen({ key, task, state: { phase: 'running', file } });
    ipc
      .fixPropose({ task, sessionId, ...note }, () => undefined)
      .then((proposal) => {
        settle(task, { phase: 'proposed', proposal });
      })
      .catch((error: unknown) => {
        if (error instanceof IpcError && error.code === 'CANCELLED') return;
        const message = error instanceof Error ? error.message : String(error);
        settle(task, { phase: 'failed', file, message });
      });
  };

  const close = () => {
    if (useFixStore.getState().open?.key === key) useFixStore.getState().setOpen(null);
  };

  const cancel = () => {
    const current = useFixStore.getState().open;
    if (current?.key !== key) return;
    useFixStore.getState().setOpen(null);
    void ipc.claudeCancel(current.task).catch(() => undefined);
  };

  const accept = () => {
    const current = useFixStore.getState().open;
    if (current?.key !== key || current.state.phase !== 'proposed' || current.state.accepting)
      return;
    const proposed = current.state;
    const { settle } = useFixStore.getState();
    settle(current.task, { phase: 'proposed', proposal: proposed.proposal, accepting: true });
    ipc
      .fixAccept(proposed.proposal.id)
      .then(() => {
        settle(current.task, { phase: 'applied' });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        settle(current.task, { phase: 'proposed', proposal: proposed.proposal, error: message });
      });
  };

  const discard = () => {
    const current = useFixStore.getState().open;
    if (current?.key !== key || current.state.phase !== 'proposed') return;
    const { id } = current.state.proposal;
    useFixStore.getState().setOpen(null);
    void ipc.fixDiscard(id).catch(() => undefined);
  };

  return { state: mine?.state ?? null, blocked, start, cancel, close, accept, discard };
}
