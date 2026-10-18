import { useState, type ReactNode } from 'react';
import { lineKey } from '../../diff/rows';
import type { Thread } from '../../ipc/types/Thread';
import { ThreadMark } from './GutterMarks';
import { ThreadCard } from './ThreadCard';
import type { ThreadScope } from './useThreadCard';

/** One thread of a file, keyed by the diff line it sits on (`lineKey`). */
export interface ThreadRow {
  /** GitLab's discussion id. */
  id: string;
  key: string;
  /** The gutter thread icon, which closes and opens the card. */
  mark: ReactNode;
  /** The card under the line while the thread is open, else null. */
  card: ReactNode;
}

/**
 * Where a thread sits in the diff, on its position's side (new, else old): its line, or for a
 * thread written on another version the line the core placed it on (F-11.3); none without one.
 */
function threadAt(thread: Thread): { key: string; line: number } | null {
  const pos = thread.position;
  if (!pos) return null;
  const side = pos.newLine !== undefined ? 'new' : 'old';
  const line = thread.outdated ? thread.placedLine : (pos.newLine ?? pos.oldLine);
  return line === undefined ? null : { key: lineKey(side, line), line };
}

/**
 * The existing GitLab threads on a file's lines (F-06.9, F-11.1), the same in Focus and Detailed
 * mode (M5 decision 3): each one's gutter icon on its line and, open by default, its card under
 * the line. The icon closes and opens the card; that choice lasts while the file is shown. With
 * the session and step, the cards have Resolve, Reply and Reopen (F-11.2).
 */
export function useThreadRows(threads: readonly Thread[], scope?: ThreadScope): ThreadRow[] {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const rows: ThreadRow[] = [];
  for (const thread of threads) {
    const at = threadAt(thread);
    if (!at) continue;
    const isOpen = !closed.has(thread.id);
    rows.push({
      id: thread.id,
      key: at.key,
      mark: (
        <ThreadMark
          key={thread.id}
          thread={thread}
          line={at.line}
          open={isOpen}
          onToggle={() => {
            setClosed((old) => {
              const next = new Set(old);
              if (isOpen) next.add(thread.id);
              else next.delete(thread.id);
              return next;
            });
          }}
        />
      ),
      card: isOpen ? (
        <ThreadCard key={thread.id} thread={thread} line={at.line} scope={scope} />
      ) : null,
    });
  }
  return rows;
}
