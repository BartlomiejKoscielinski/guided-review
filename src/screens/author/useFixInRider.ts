import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toIpcError, type IpcError } from '../../ipc/errors';
import { authorFileDiffKey } from '../../ipc/hooks/useAuthorMr';
import { useIpc } from '../../ipc/IpcContext';

/** Where **Fix in Rider** is: not started, waiting for the file to change, or the change seen. */
export type RiderFixPhase = 'idle' | 'waiting' | 'changed';

export interface RiderFix {
  phase: RiderFixPhase;
  /** Rider that could not be opened or a watch that could not start. */
  error: IpcError | null;
  start: () => void;
  /** **Stop waiting**. */
  stop: () => void;
}

/**
 * **Fix in Rider** on an S-10 thread (F-26.3, M7 decision 7): opens `path` at `line` in Rider,
 * then watches that one file; its change ends the waiting and reads the file's diff again. The
 * watch ends on the change, on Stop waiting and when the component unmounts (another thread, S-10
 * left). A late event of an ended watch is ignored.
 */
export function useFixInRider(path: string | null, line: number, target: string): RiderFix {
  const ipc = useIpc();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<RiderFixPhase>('idle');
  const [error, setError] = useState<IpcError | null>(null);
  // The running watch: a token per start, and the function that ends it once it is known.
  const watch = useRef<{ token: object; end: (() => void) | null } | null>(null);

  const end = useCallback(() => {
    const current = watch.current;
    watch.current = null;
    current?.end?.();
  }, []);

  useEffect(() => end, [end]);

  const start = useCallback(() => {
    if (path === null) return;
    end();
    const token = {};
    watch.current = { token, end: null };
    const live = () => watch.current?.token === token;
    setError(null);
    void (async () => {
      try {
        await ipc.riderOpen(path, line);
        if (!live()) return;
        setPhase('waiting');
        const stopWatch = await ipc.fixWatch(path, () => {
          // The only event is `changed`; an ended watch's late one is ignored.
          if (!live()) return;
          end();
          setPhase('changed');
          void queryClient.invalidateQueries({ queryKey: authorFileDiffKey(target, path) });
        });
        if (live() && watch.current) watch.current.end = stopWatch;
        else stopWatch();
      } catch (e: unknown) {
        if (!live()) return;
        watch.current = null;
        setPhase('idle');
        setError(toIpcError(e));
      }
    })();
  }, [end, ipc, line, path, queryClient, target]);

  const stop = useCallback(() => {
    end();
    setPhase('idle');
  }, [end]);

  return { phase, error, start, stop };
}
