import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { MenuButton, type MenuAction } from '../../components/MenuButton';
import { Tag } from '../../components/Tag';
import { useDecide } from '../../ipc/hooks/useReview';
import type { Finding } from '../../ipc/types/Finding';
import type { FindingDecision } from '../../ipc/types/FindingDecision';
import { ClaudeLabel } from './ClaudeLabel';
import { DISMISSED, SEVERITY_TAG, decisionCopy } from './noteCopy';
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
  const decide = useDecide(sessionId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(finding.suggestedComment);
  const undo = useRef<HTMLButtonElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  /** Where the keyboard focus goes once a decision made on this card settles. */
  const focusNext = useRef<'undo' | 'add' | null>(null);
  const copy = decisionCopy(selfReview);
  const tag = SEVERITY_TAG[finding.severity];
  const open = finding.decision === 'open';
  const pending = decide.isPending;

  // A decision hands the focus to Undo; Undo hands it back to Add to drafts (the buttons are
  // disabled while the decision is pending, so wait for it to settle).
  useEffect(() => {
    if (pending) return;
    if (focusNext.current === 'undo' && !open) undo.current?.focus();
    if (focusNext.current === 'add' && open) add.current?.focus();
    focusNext.current = null;
  }, [open, pending]);
  useEffect(() => {
    if (editing) textarea.current?.focus();
  }, [editing]);

  const send = (decision: FindingDecision) => {
    focusNext.current = decision.kind === 'undo' ? 'add' : 'undo';
    decide.mutate(
      { findingId: finding.id, decision },
      {
        onSuccess: () => {
          setEditing(false);
        },
      },
    );
  };
  const more: MenuAction[] = [
    {
      label: copy.editAndAdd,
      onSelect: () => {
        setText(finding.suggestedComment);
        setEditing(true);
      },
    },
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
            send({ kind: 'editAndAdd', body: text.trim() });
          }}
        >
          <textarea
            ref={textarea}
            className={styles.textarea}
            aria-label="Suggested comment"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
          <div className={styles.actions}>
            <Button
              type="submit"
              variant="primary"
              disabled={text.trim() === '' || decide.isPending}
            >
              {copy.add}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {open && !editing && (
        <div className={styles.actions}>
          <Button
            ref={add}
            variant="primary"
            disabled={decide.isPending}
            onClick={() => {
              send({ kind: 'addToDrafts' });
            }}
          >
            {copy.add}
          </Button>
          <Button
            disabled={decide.isPending}
            onClick={() => {
              send({ kind: 'dismiss' });
            }}
          >
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
          <Button
            ref={undo}
            size={30}
            disabled={decide.isPending}
            onClick={() => {
              send({ kind: 'undo' });
            }}
          >
            Undo
          </Button>
        </div>
      )}

      {decide.error && (
        <p className={styles.error} role="alert">
          {decide.error.message}
        </p>
      )}
    </article>
  );
}
