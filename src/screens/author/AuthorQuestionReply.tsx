import { useId } from 'react';
import type { AuthorThread } from '../../ipc/types/AuthorThread';
import { answeredText, isAnswered } from './authorText';
import styles from './AuthorQuestionReply.module.css';
import { useQuestionReply } from './useQuestionReply';

export interface AuthorQuestionReplyProps {
  thread: AuthorThread;
  project: string;
  iid: number;
}

/**
 * The answer of a question thread on S-10 (F-26.7, Author.dc.html `isQuestion`): the text area
 * "Your reply", **Draft with Claude** (fills a proposed answer, sends nothing; "Drafting…" while it
 * runs) and **Send reply** (at once, as typed). Once answered: "Answered. The thread stays open
 * until <reviewer> resolves it."
 */
export function AuthorQuestionReply({ thread, project, iid }: AuthorQuestionReplyProps) {
  const id = useId();
  const reply = useQuestionReply(project, iid, thread.id);
  if (isAnswered(thread) || reply.phase === 'sent') {
    return (
      <span className={styles.answered}>
        <span className={styles.mark} />
        {answeredText(thread.author)}
      </span>
    );
  }
  const drafting = reply.phase === 'drafting';
  const busy = drafting || reply.phase === 'sending';
  return (
    <div className={styles.composer}>
      <label htmlFor={id} className={styles.label}>
        Your reply
      </label>
      <textarea
        id={id}
        rows={4}
        className={styles.text}
        placeholder="Write a reply…"
        value={reply.text}
        readOnly={busy}
        aria-busy={busy}
        onChange={(e) => {
          reply.setText(e.target.value);
        }}
      />
      {reply.error !== null && (
        <p role="alert" className={styles.error}>
          {reply.error}
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.draft} disabled={busy} onClick={reply.draft}>
          {drafting ? 'Drafting…' : 'Draft with Claude'}
        </button>
        <button
          type="button"
          className={styles.send}
          disabled={busy || reply.text.trim() === ''}
          onClick={reply.send}
        >
          Send reply
        </button>
        <span className={styles.hint}>Replies on your MR go out right away.</span>
      </div>
    </div>
  );
}
