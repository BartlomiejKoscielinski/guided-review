import type { UseQueryResult } from '@tanstack/react-query';
import type { IpcError } from '../../ipc/errors';
import type { Draft } from '../../ipc/types/Draft';
import type { Thread } from '../../ipc/types/Thread';

/** The tabs of S-05 of an MR session (SummaryDesk.dc.html), in their order. */
export type SummaryTab = 'drafts' | 'threads';

/**
 * The tab S-05 opens on (M5 decision 5): Drafts when the session has an unpublished draft, else
 * Threads. On a restored start (`restored`) a session with any draft, published ones included,
 * opens on Drafts: the threads aren't read then (F-30.4), and the app comes back to the rows it
 * showed (F-12.5). Null while the drafts are read, a read started before the screen opened
 * included, so the screen never shows one tab and then jumps to the other. A failed read opens on
 * Drafts, where the failure belongs (F-12.3).
 */
export function openingTab(
  drafts: UseQueryResult<Draft[], IpcError>,
  restored = false,
): SummaryTab | null {
  if (drafts.isFetching) return null;
  if (drafts.isError) return 'drafts';
  if (!drafts.data) return null;
  if (restored && drafts.data.length > 0) return 'drafts';
  return drafts.data.some((d) => d.publishedNoteId === null) ? 'drafts' : 'threads';
}

/** Open threads: resolvable and not resolved, as the core counts them (`Thread::is_open`). */
export const openThreadCount = (threads: readonly Thread[]): number =>
  threads.filter((t) => t.resolvable && !t.resolved).length;
