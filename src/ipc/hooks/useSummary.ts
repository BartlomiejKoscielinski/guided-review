import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { IpcClient } from '../client';
import type { IpcError } from '../errors';
import { useIpc } from '../IpcContext';
import type { SummaryField } from '../types/SummaryField';

export const summaryKey = (sessionId: string) => ['summary', sessionId] as const;

/**
 * The session's "Add a summary comment" tick, text and suggested flag (F-12.4), read from this
 * PC. The screen writes it itself (`persistSummary`), so the cached copy is never stale.
 */
export function useSessionSummary(sessionId: string): UseQueryResult<SummaryField, IpcError> {
  const ipc = useIpc();
  return useQuery<SummaryField, IpcError>({
    queryKey: summaryKey(sessionId),
    queryFn: () => ipc.sessionSummary(sessionId),
    enabled: sessionId !== '',
    staleTime: Infinity,
  });
}

/** A session's writes: the one in flight and the newest field still to be written. */
interface Writer {
  busy: Promise<void> | null;
  latest: SummaryField | null;
}

const writers = new WeakMap<IpcClient, Map<string, Writer>>();

function writerOf(ipc: IpcClient, sessionId: string): Writer {
  let bySession = writers.get(ipc);
  if (!bySession) {
    bySession = new Map();
    writers.set(ipc, bySession);
  }
  let writer = bySession.get(sessionId);
  if (!writer) {
    writer = { busy: null, latest: null };
    bySession.set(sessionId, writer);
  }
  return writer;
}

/** Writes the newest field until none is left; `busy` is cleared in the same step as the check. */
async function drain(ipc: IpcClient, sessionId: string, writer: Writer): Promise<void> {
  try {
    for (;;) {
      const field = writer.latest;
      if (!field) {
        writer.busy = null;
        return;
      }
      writer.latest = null;
      await ipc.sessionSetSummary(sessionId, field);
    }
  } catch (error) {
    writer.busy = null;
    throw error;
  }
}

/**
 * Keeps `field` for the session. One write at a time, and a field typed while one is in flight
 * replaces the one waiting, so an earlier keystroke never lands after a later one and a burst of
 * typing costs two writes. Resolves once nothing newer is left to write.
 */
export function persistSummary(
  ipc: IpcClient,
  sessionId: string,
  field: SummaryField,
): Promise<void> {
  const writer = writerOf(ipc, sessionId);
  writer.latest = field;
  writer.busy ??= drain(ipc, sessionId, writer);
  return writer.busy;
}
