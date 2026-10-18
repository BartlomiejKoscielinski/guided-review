import type { Thread } from '../../ipc/types/Thread';

/** The filters of S-05's Threads tab (F-13.1, SummaryDesk.dc.html), in their order. */
export type ThreadFilter = 'all' | 'open' | 'resolved';

/** The threads the Threads tab lists (M5 decision 13): a comment that can't be resolved is not. */
export const resolvableThreads = (threads: readonly Thread[]): Thread[] =>
  threads.filter((t) => t.resolvable);

/** The listed threads the filter keeps; All keeps every one. */
export function filterThreads(threads: readonly Thread[], filter: ThreadFilter): Thread[] {
  const listed = resolvableThreads(threads);
  if (filter === 'all') return listed;
  return listed.filter((t) => t.resolved === (filter === 'resolved'));
}

/** The filters' labels: All, Open N, Resolved N, counted over every listed thread, not the pick. */
export function filterLabels(
  threads: readonly Thread[],
): readonly { id: ThreadFilter; label: string }[] {
  const listed = resolvableThreads(threads);
  const resolved = listed.filter((t) => t.resolved).length;
  return [
    { id: 'all', label: 'All' },
    { id: 'open', label: `Open ${String(listed.length - resolved)}` },
    { id: 'resolved', label: `Resolved ${String(resolved)}` },
  ];
}
