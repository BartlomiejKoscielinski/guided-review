import { useCallback, useEffect, useMemo, useRef } from 'react';
import { isTypingOrControl } from '../../app/keyboard';
import { isShortcutKey } from '../../app/shortcuts';
import { useMarkFile } from '../../ipc/hooks/useMarks';
import { useSessionState } from '../../ipc/hooks/useSessionState';
import type { FileDiff } from '../../ipc/types/FileDiff';
import { pathOf } from './diffPath';

export interface FileMarks {
  /** The file is marked reviewed in the step: all its files are once the step is reviewed. */
  isReviewed: (path: string) => boolean;
  /** Marks the file of the step, or takes its mark back. */
  toggle: (path: string) => void;
  /** Marks the file of the step; a marked file stays as it is (`↓` past its end, F-30.6). */
  mark: (path: string) => void;
}

export interface FileMarksOptions {
  sessionId: string;
  stepId: string;
  /** The step's files (`StepView.files`), in the diff's order. */
  files: readonly FileDiff[];
  /** The step is reviewed; undefined while it loads (nothing to mark yet). */
  stepReviewed: boolean | undefined;
  /** The file of the current change (the one the arrow keys made current), if any. */
  current: string | undefined;
}

/**
 * The step's file marks on S-03 and S-04 (F-07.10): each file's Reviewed toggle reads and writes
 * them, the walk's `↓` marks a file past its end (F-30.6), and `Space` toggles the current file - the file of the current change, else the step's
 * first file - without moving. In a field or on a control Space keeps its own meaning (typing,
 * pressing what has the focus); elsewhere it doesn't scroll the page.
 */
export function useFileMarks({
  sessionId,
  stepId,
  files,
  stepReviewed,
  current,
}: FileMarksOptions): FileMarks {
  const marked = useSessionState(sessionId).data?.reviewedFiles[stepId];
  const { mutate } = useMarkFile(sessionId);
  const paths = useMemo(() => files.map(pathOf), [files]);
  const isReviewed = useCallback(
    (path: string) => stepReviewed === true || (marked?.includes(path) ?? false),
    [stepReviewed, marked],
  );
  const toggle = useCallback(
    (path: string) => {
      if (stepReviewed === undefined || !paths.includes(path)) return;
      mutate({ stepId, file: path, reviewed: !isReviewed(path), paths });
    },
    [mutate, stepId, stepReviewed, paths, isReviewed],
  );
  const mark = useCallback(
    (path: string) => {
      if (!isReviewed(path)) toggle(path);
    },
    [isReviewed, toggle],
  );

  const target = current !== undefined && paths.includes(current) ? current : paths[0];
  const latest = useRef({ toggle, target });
  useEffect(() => {
    latest.current = { toggle, target };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isShortcutKey(event, 'markFile') || event.defaultPrevented) return;
      if (isTypingOrControl(event.target)) return;
      event.preventDefault();
      const { toggle: run, target: file } = latest.current;
      if (!event.repeat && file !== undefined) run(file);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return useMemo(() => ({ isReviewed, toggle, mark }), [isReviewed, toggle, mark]);
}
