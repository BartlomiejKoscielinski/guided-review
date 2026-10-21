import type { Ref } from 'react';
import { Tag } from '../../components/Tag';
import type { BlockColor } from '../../components/colors';
import type { AuthorThread } from '../../ipc/types/AuthorThread';
import { STATUS_TAG } from './authorText';
import styles from './Author.module.css';

export interface ThreadListItemProps {
  thread: AuthorThread;
  avatarColor: BlockColor;
  selected: boolean;
  onSelect: () => void;
  buttonRef: Ref<HTMLButtonElement>;
}

/** One thread of S-10's list: avatar, author, `file:line`, a two-line excerpt and its tag. */
export function ThreadListItem({
  thread,
  avatarColor,
  selected,
  onSelect,
  buttonRef,
}: ThreadListItemProps) {
  const tag = STATUS_TAG[thread.status];
  return (
    <button
      ref={buttonRef}
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      className={styles.thread}
      onClick={onSelect}
    >
      <span className={styles.avatar} data-color={avatarColor} aria-hidden="true">
        {thread.avatar}
      </span>
      <span className={styles.threadBody}>
        <span className={styles.threadHead}>
          <span className={styles.threadAuthor}>{thread.author}</span>
          <span className={styles.threadPlace}>{thread.place}</span>
        </span>
        <span className={styles.excerpt}>{thread.excerpt}</span>
        <span className={styles.threadTag}>
          <Tag color={tag.color} size="s">
            {tag.word}
          </Tag>
        </span>
      </span>
    </button>
  );
}
