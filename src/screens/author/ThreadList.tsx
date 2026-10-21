import { useRef, type KeyboardEvent } from 'react';
import type { AuthorThread } from '../../ipc/types/AuthorThread';
import { avatarColors } from './authorText';
import { ThreadListItem } from './ThreadListItem';
import styles from './Author.module.css';

export interface ThreadListProps {
  threads: AuthorThread[];
  selected: string | null;
  onSelect: (id: string) => void;
}

/**
 * S-10's thread list (F-26.1): a listbox with one option per open thread, a roving tab stop on
 * the selected one; Up and Down (Home and End) move the selection and the focus, without wrapping.
 */
export function ThreadList({ threads, selected, onSelect }: ThreadListProps) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const colors = avatarColors(threads);
  const index = threads.findIndex((t) => t.id === selected);

  const move = (to: number) => {
    const target = threads[Math.max(0, Math.min(threads.length - 1, to))];
    if (!target) return;
    onSelect(target.id);
    buttons.current.get(target.id)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: threads.length - 1,
    };
    const to = next[event.key];
    if (to === undefined) return;
    event.preventDefault();
    move(to);
  };

  return (
    <div role="listbox" aria-label="Threads" className={styles.list} onKeyDown={onKeyDown}>
      {threads.map((thread, i) => (
        <ThreadListItem
          key={thread.id}
          thread={thread}
          avatarColor={colors[i] ?? 'green'}
          selected={thread.id === selected}
          onSelect={() => {
            onSelect(thread.id);
          }}
          buttonRef={(el) => {
            if (el) buttons.current.set(thread.id, el);
            else buttons.current.delete(thread.id);
          }}
        />
      ))}
    </div>
  );
}
