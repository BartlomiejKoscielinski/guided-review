import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { MenuButton, type MenuAction } from '../../components/MenuButton';
import { Tag } from '../../components/Tag';
import type { Finding } from '../../ipc/types/Finding';
import { ClaudeLabel } from './ClaudeLabel';
import { DISMISSED, SEVERITY_TAG, decisionCopy } from './noteCopy';
import { useNoteDecision } from './useNoteDecision';
import styles from './Notes.module.css';

export interface NoteCardProps {
  finding: Finding;
  sessionId: string;
  /** Self-review: Keep to fix instead of Add to drafts (M3 decision 2). */
  selfReview?: boolean;
  /** More › Ask Claude: the screen opens the answer card on the note's line (F-10.1). */
  onAsk?: (finding: Finding) => void;
}

/**
 * A Claude note in Focus mode (F-07.6, F-09.2, F-09.3): severity tag, title, Claude label, body,
 * Add to drafts, Dismiss and More (Edit and add, Ask Claude, Copy). A decided note shows its
 * confirmation and Undo. Decisions stay on this PC.
 */
export function NoteCard({ finding, sessionId, selfReview = false, onAsk }: NoteCardProps) {
  const {
    open,
    editing,
    pending,
    error,
    text,
    setText,
    addRef,
    undoRef,
    textareaRef,
    startEdit,
    cancelEdit,
    add,
    addEdited,
    dismiss,
    undo,
  } = useNoteDecision(finding, sessionId);
  const copy = decisionCopy(selfReview);
  const tag = SEVERITY_TAG[finding.severity];

  const more: MenuAction[] = [
    { label: copy.editAndAdd, onSelect: startEdit },
    ...(onAsk
      ? [
          {
            label: 'Ask Claude',
            onSelect: () => {
              onAsk(finding);
            },
          },
        ]
      : []),
    {
      label: 'Copy',
      onSelect: () => {
        navigator.clipboard.writeText(finding.suggestedComment).catch(() => undefined);
      },
    },
  ];

  return (
    <article className={styles.card} aria-label={`Claude note: ${finding.title}`}>
      <div className={styles.head}>
        <Tag color={tag.color}>{tag.label}</Tag>
        <span
          className={cx(styles.title, finding.decision === 'dismissed' && styles.titleDismissed)}
        >
          {finding.title}
        </span>
        <ClaudeLabel />
      </div>
      <p className={styles.body}>{finding.body}</p>

      {open && editing && (
        <form
          className={styles.editor}
          onSubmit={(event) => {
            event.preventDefault();
            addEdited();
          }}
        >
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            aria-label="Suggested comment"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={text.trim() === '' || pending}>
              {copy.add}
            </Button>
            <Button variant="ghost" onClick={cancelEdit}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {open && !editing && (
        <div className={styles.actions}>
          <Button ref={addRef} variant="primary" disabled={pending} onClick={add}>
            {copy.add}
          </Button>
          <Button disabled={pending} onClick={dismiss}>
            Dismiss
          </Button>
          <MenuButton label="More" menuLabel={`More for ${finding.title}`} actions={more} />
        </div>
      )}

      {!open && (
        <div
          className={cx(styles.status, finding.decision === 'dismissed' && styles.statusDismissed)}
        >
          <span>{finding.decision === 'draft' ? copy.added : DISMISSED}</span>
          <Button ref={undoRef} size={30} disabled={pending} onClick={undo}>
            Undo
          </Button>
        </div>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error.message}
        </p>
      )}
    </article>
  );
}
