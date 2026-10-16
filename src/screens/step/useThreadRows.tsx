import { useState, type ReactNode } from 'react';
import { lineKey } from '../../diff/rows';
import type { Thread } from '../../ipc/types/Thread';
import { ThreadMark } from './GutterMarks';
import { ThreadCard } from './ThreadCard';

/** One thread of a file, keyed by the diff line it sits on (`lineKey`). */
export interface ThreadRow {
  key: string;
  /** The gutter thread icon, which closes and opens the card. */
  mark: ReactNode;
  /** The card under the line while the thread is open, else null. */
  card: ReactNode;
}

/** Where a thread sits in the diff: its new-side line, else its old-side line. */
function threadAt(thread: Thread): { key: string; line: number } | null {
  const pos = thread.position;
  if (pos?.newLine !== undefined) return { key: lineKey('new', pos.newLine), line: pos.newLine };
  if (pos?.oldLine !== undefined) return { key: lineKey('old', pos.oldLine), line: pos.oldLine };
  return null;
}

/**
 * The existing GitLab threads on a file's lines (F-06.9, F-11.1), the same in Focus and Detailed
 * mode (M5 decision 3): each one's gutter icon on its line and, open by default, its card under
 * the line. The icon closes and opens the card; that choice lasts while the file is shown.
 */
export function useThreadRows(threads: readonly Thread[]): ThreadRow[] {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const rows: ThreadRow[] = [];
  for (const thread of threads) {
    const at = threadAt(thread);
    if (!at) continue;
    const isOpen = !closed.has(thread.id);
    rows.push({
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
      card: isOpen ? <ThreadCard key={thread.id} thread={thread} line={at.line} /> : null,
    });
  }
  return rows;
}
