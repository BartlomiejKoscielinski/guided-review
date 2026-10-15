import { useState } from 'react';
import { Button } from '../../components/Button';
import styles from './Summary.module.css';

export interface CopyChecklistProps {
  /** The checklist; the button is off while there is nothing to copy. */
  text: string;
}

/** Copy as checklist (F-17.4): the text goes to the clipboard, a status line says whether it did. */
export function CopyChecklist({ text }: CopyChecklistProps) {
  const [result, setResult] = useState<{ text: string; copied: boolean } | null>(null);
  const shown = result?.text === text ? result : null;

  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => {
        setResult({ text, copied: true });
      },
      () => {
        setResult({ text, copied: false });
      },
    );
  };

  return (
    <div className={styles.copy}>
      <span role="status" className={styles.copyStatus}>
        {shown && (shown.copied ? 'Copied.' : 'Couldn’t copy.')}
      </span>
      <Button variant="primary" size={40} disabled={text === ''} onClick={copy}>
        Copy as checklist
      </Button>
    </div>
  );
}
