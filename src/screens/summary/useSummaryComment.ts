import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { toIpcError } from '../../ipc/errors';
import { CLAUDE_STATUS_KEY } from '../../ipc/hooks/useClaude';
import { persistSummary, summaryKey, useSessionSummary } from '../../ipc/hooks/useSummary';
import { useIpc } from '../../ipc/IpcContext';
import type { ErrorCode } from '../../ipc/types/ErrorCode';
import type { SummaryField } from '../../ipc/types/SummaryField';

/** Claude writes (`running`), couldn't write (`failed`, with Retry), or nothing is going on. */
export type SummaryPhase = 'idle' | 'running' | 'failed';

export interface SummaryComment {
  /** The tick, the text and whether Claude wrote it; undefined while it is read. */
  field: SummaryField | undefined;
  phase: SummaryPhase;
  /** Reading or keeping the field failed. */
  error: string | null;
  toggle: () => void;
  edit: (text: string) => void;
  retry: () => void;
}

/** Claude can't be used at all: the area stays empty without a label (M5 decision 11). */
const UNUSABLE: ReadonlySet<ErrorCode> = new Set(['CLAUDE_NOT_FOUND', 'CLAUDE_NOT_SIGNED_IN']);

const EMPTY: SummaryField = { enabled: false, text: '', suggested: false };

/**
 * "Add a summary comment" of S-05 (F-12.4, M5 decision 11). Ticking with an empty area runs the
 * summary task once: the tick is the explicit action, nothing runs in the background. While it
 * runs the area stays editable; whatever the reviewer types wins and the run's answer is dropped.
 * The field is kept per session on every change; the run outlives a tab switch because the
 * screen, not the tab, holds this hook.
 */
export function useSummaryComment(sessionId: string): SummaryComment {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const query = useSessionSummary(sessionId);
  // The area's own copy: the query cache tells its observers a tick later, which would move the
  // caret while typing.
  const [local, setLocal] = useState<SummaryField | null>(null);
  const [phase, setPhase] = useState<SummaryPhase>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The run whose answer is still wanted; null once the reviewer typed or it ended. */
  const wanted = useRef<number | null>(null);
  const runs = useRef(0);

  const key = summaryKey(sessionId);
  const read = (): SummaryField => queryClient.getQueryData<SummaryField>(key) ?? EMPTY;
  const save = (field: SummaryField) => {
    queryClient.setQueryData(key, field);
    setLocal(field);
    void persistSummary(ipc, sessionId, field).then(
      () => {
        setSaveError(null);
      },
      (error: unknown) => {
        setSaveError(toIpcError(error).message);
      },
    );
  };

  const suggest = () => {
    runs.current += 1;
    const run = runs.current;
    wanted.current = run;
    setPhase('running');
    void ipc
      .claudeSummaryComment(sessionId, () => undefined)
      .then(
        ({ summary }) => {
          if (wanted.current !== run) return;
          wanted.current = null;
          setPhase('idle');
          const now = read();
          // Words written meanwhile (the screen was left and opened again) win as well.
          if (now.text !== '') return;
          save({ ...now, text: summary, suggested: summary !== '' });
        },
        (error: unknown) => {
          if (wanted.current !== run) return;
          wanted.current = null;
          setPhase(UNUSABLE.has(toIpcError(error).code) ? 'idle' : 'failed');
        },
      )
      .finally(() => {
        // The status follows the task result (F-18.1, F-18.7).
        void queryClient.invalidateQueries({ queryKey: CLAUDE_STATUS_KEY });
      });
  };

  return {
    field: local ?? query.data,
    phase,
    error: saveError ?? query.error?.message ?? null,
    toggle: () => {
      const now = read();
      const enabled = !now.enabled;
      save({ ...now, enabled });
      if (enabled && now.text === '' && wanted.current === null) suggest();
    },
    edit: (text) => {
      const now = read();
      if (wanted.current !== null) {
        // Typed while Claude writes: the reviewer's words win, the answer is dropped.
        wanted.current = null;
        setPhase('idle');
        save({ ...now, text, suggested: false });
        return;
      }
      if (phase === 'failed') setPhase('idle');
      save({ ...now, text, suggested: text !== '' && now.suggested });
    },
    retry: suggest,
  };
}
