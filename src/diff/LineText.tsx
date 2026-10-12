import type { Line } from '../ipc/types/Line';
import type { Token } from './highlight-protocol';
import { segments } from './segments';
import styles from './DiffView.module.css';

export interface LineTextProps {
  line: Line;
  tokens: Token[] | undefined;
}

/** Code of one line: syntax colors from the worker and intraline emphasis (F-15.5). */
export function LineText({ line, tokens }: LineTextProps) {
  const parts = segments(line.text, tokens, line.emphasis);
  const em = line.kind === 'add' ? styles.emAdd : line.kind === 'del' ? styles.emDel : undefined;
  return (
    <span className={styles.code}>
      {parts.map((part, i) => (
        <span
          // Segments of a line never reorder.
          key={i}
          className={part.emphasized ? em : undefined}
          style={part.color ? { color: part.color } : undefined}
        >
          {part.text}
        </span>
      ))}
    </span>
  );
}
