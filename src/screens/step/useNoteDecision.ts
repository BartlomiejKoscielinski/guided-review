import { useEffect, useRef, useState } from 'react';
import { useDecide } from '../../ipc/hooks/useReview';
import type { Finding } from '../../ipc/types/Finding';
import type { FindingDecision } from '../../ipc/types/FindingDecision';

/**
 * The decision logic a Claude note shares in S-03's note card and S-04's callout (F-09.3,
 * F-08.6): Add to drafts, Edit and add with the suggested comment, Dismiss and Undo. A decision
 * hands the keyboard focus to Undo; Undo hands it back to the add button. The buttons are
 * disabled while the decision is pending, and the mutation may settle a render before the note's
 * new state arrives, so the focus moves once both are in; a failed decision moves nothing.
 */
export function useNoteDecision(finding: Finding, sessionId: string) {
  const decide = useDecide(sessionId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(finding.suggestedComment);
  const undoRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Where the keyboard focus goes once a decision made on this note settles. */
  const focusNext = useRef<'undo' | 'add' | null>(null);
  const open = finding.decision === 'open';
  const pending = decide.isPending;

  useEffect(() => {
    if (pending) return;
    const target =
      focusNext.current === 'undo' && !open
        ? undoRef.current
        : focusNext.current === 'add' && open
          ? addRef.current
          : undefined;
    if (target === undefined) return;
    target?.focus();
    focusNext.current = null;
  }, [open, pending]);
  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const send = (decision: FindingDecision) => {
    focusNext.current = decision.kind === 'undo' ? 'add' : 'undo';
    decide.mutate(
      { findingId: finding.id, decision },
      {
        onSuccess: () => {
          setEditing(false);
        },
        onError: () => {
          focusNext.current = null;
        },
      },
    );
  };

  return {
    open,
    pending,
    error: decide.error,
    editing,
    text,
    setText,
    undoRef,
    addRef,
    textareaRef,
    /** Edit and add: the suggested comment, as Claude wrote it, in the editor. */
    startEdit: () => {
      setText(finding.suggestedComment);
      setEditing(true);
    },
    cancelEdit: () => {
      setEditing(false);
    },
    add: () => {
      send({ kind: 'addToDrafts' });
    },
    addEdited: () => {
      send({ kind: 'editAndAdd', body: text.trim() });
    },
    dismiss: () => {
      send({ kind: 'dismiss' });
    },
    undo: () => {
      send({ kind: 'undo' });
    },
  };
}
