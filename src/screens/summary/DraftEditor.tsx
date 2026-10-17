import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import styles from './Summary.module.css';

export interface DraftEditorProps {
  /** The draft's saved text, the editor's starting value. */
  body: string;
  /** Accessible name of the text area ("Comment 2"). */
  label: string;
  /** A save is under way: Save is off until it ends. */
  busy: boolean;
  onSave: (body: string) => void;
  onCancel: () => void;
}

/**
 * The pencil's in-place editor of a draft (F-12.3, M5 decision 6): a text area holding the draft
 * with Save and Cancel; Ctrl+Enter saves, Esc cancels. A blank text can't be saved. It takes the
 * focus when it opens, with the caret after the text.
 */
export function DraftEditor({ body, label, busy, onSave, onCancel }: DraftEditorProps) {
  const [text, setText] = useState(body);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const blank = text.trim() === '';

  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  const save = () => {
    if (blank || busy) return;
    onSave(text);
  };

  return (
    <form
      className={styles.editor}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        // Esc closes this editor only, not the screen around it.
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
    >
      <textarea
        ref={fieldRef}
        className={styles.editorField}
        aria-label={label}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
          event.preventDefault();
          save();
        }}
      />
      <div className={styles.editorButtons}>
        <Button type="submit" variant="primary" size={30} disabled={blank || busy}>
          Save
        </Button>
        <Button variant="ghost" size={30} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
