import styles from './Plan.module.css';

export interface CodeTextProps {
  text: string;
}

/** Claude's text with `backtick` spans shown as inline code (Overview.dc.html `code`). */
export function CodeText({ text }: CodeTextProps) {
  const parts = text.split('`');
  // An unmatched backtick stays as text.
  if (parts.length % 2 === 0) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className={styles.code}>
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}
