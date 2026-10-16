import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Tag } from '../../components/Tag';
import { useCreateDraft, useDeleteDraft } from '../../ipc/hooks/useDrafts';
import type { Draft } from '../../ipc/types/Draft';
import { anchorLabel, type LineAnchor } from './lineComment';
import { decisionCopy } from './noteCopy';
import styles from './Notes.module.css';

export interface LineComposerProps {
  sessionId: string;
  /** The line the comment is on. */
  anchor: LineAnchor;
  /** Self-review: Keep to fix instead of Add to drafts (M4 decision 12). */
  selfReview: boolean;
  /** The draft the card shows with the confirmation and Undo; null: the text area to write one. */
  draft: { id: string; body: string } | null;
  /** The text it opens with: what was typed before a remount, or the text Undo brought back. */
  text?: string;
  /** Each change of the text: the screen keeps it, so a remount (mode switch, scroll) keeps it. */
  onText?: (text: string) => void;
  /** A new number moves the keyboard focus back to the text area. */
  focus?: number;
  /** The draft was made: the screen keeps the card on it. */
  onAdded?: (draft: Draft) => void;
  /** Cancel or Esc: the composer is discarded, nothing is saved. */
  onCancel?: () => void;
  /** Undo deleted the draft: the screen opens the composer with its text again. */
  onUndone: (body: string) => void;
  /**
   * Asked before Undo deletes the draft: false keeps it, as a comment being written elsewhere
   * takes the focus instead and keeps its text.
   */
  canUndo?: () => boolean;
}

/**
 * A comment on a diff line in the note-card style (F-09.7, M4 decision 13): a "Comment" tag with
 * the line, the text area, Add to drafts (Ctrl+Enter, disabled while empty) and Cancel (Esc).
 * Its draft has the line's position and no note; then the card keeps the text with the F-09.3
 * confirmation and Undo, which deletes the draft. Drafts stay on this PC until Publish.
 */
export function LineComposer({
  sessionId,
  anchor,
  selfReview,
  draft,
  text: initialText = '',
  focus = 0,
  onText,
  onAdded,
  onCancel,
  onUndone,
  canUndo,
}: LineComposerProps) {
  const copy = decisionCopy(selfReview);
  const [text, setText] = useState(initialText);
  const create = useCreateDraft(onAdded);
  const remove = useDeleteDraft(sessionId, () => {
    if (draft) onUndone(draft.body);
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const editing = draft === null;
  // A card opened to write a comment hands the keyboard focus to Undo once its draft is made, as
  // a note's decision does (F-09.3); a draft listed when the step opens takes no focus.
  const [startedEditing] = useState(editing);
  const label = anchorLabel(anchor);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing, focus]);
  useEffect(() => {
    if (!editing && startedEditing) undoRef.current?.focus();
  }, [editing, startedEditing]);

  const add = () => {
    const body = text.trim();
    if (body === '' || create.isPending) return;
    create.mutate({
      sessionId,
      findingId: null,
      body,
      position: { file: anchor.file, side: anchor.side, line: anchor.line },
      severity: null,
    });
  };
  const error = create.error ?? remove.error;

  return (
    <article
      className={styles.card}
      aria-label={`Comment on ${label}`}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !editing || !onCancel) return;
        // Esc closes the composer only: the selected lines stay.
        event.preventDefault();
        onCancel();
      }}
    >
      <div className={styles.head}>
        <Tag color="muted">Comment</Tag>
        <span className={styles.lines}>{label}</span>
      </div>

      {editing ? (
        <form
          className={styles.editor}
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            aria-label="Comment"
            placeholder="Write a comment…"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              onText?.(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !event.ctrlKey) return;
              event.preventDefault();
              add();
            }}
          />
          <div className={styles.actions}>
            <Button
              type="submit"
              variant="primary"
              disabled={text.trim() === '' || create.isPending}
            >
              {copy.add}
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className={styles.body}>{draft.body}</p>
          <div className={styles.status}>
            <span>{copy.added}</span>
            <Button
              ref={undoRef}
              size={30}
              disabled={remove.isPending}
              onClick={() => {
                if (canUndo?.() !== false) remove.mutate(draft.id);
              }}
            >
              Undo
            </Button>
          </div>
        </>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error.message}
        </p>
      )}
    </article>
  );
}
