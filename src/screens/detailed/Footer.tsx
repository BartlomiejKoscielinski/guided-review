import { Fragment } from 'react';
import { DETAILED_FOOTER_HINTS } from '../../app/shortcuts';
import { cx } from '../../components/cx';
import { Kbd } from '../../components/Kbd';
import { useAnalysisStatus } from '../../ipc/hooks/useAnalysisStatus';
import { useClaudeStatus } from '../../ipc/hooks/useClaude';
import { statusText } from '../settings/claudeStatusText';
import { claudeLine, codeAtText, isUnusable } from './footerText';
import styles from './Footer.module.css';

export interface FooterProps {
  sessionId: string;
  /** The steps in the reader's order: the numbers of the Claude line. */
  order: readonly string[];
  /** The open step: only the steps after it count as ready. */
  current: string | undefined;
}

/**
 * S-04's footer (F-08.8, Main.dc.html): the shortcut hints, then Claude's status after a square
 * (purple; orange with Claude Code's status words when it can't run tasks) and the code Claude
 * reads. While the status loads, or when it can't be read, only the hints show.
 */
export function Footer({ sessionId, order, current }: FooterProps) {
  const status = useAnalysisStatus(sessionId).data;
  const claude = useClaudeStatus().data;
  const unusable = isUnusable(claude);
  let line: string | null = null;
  if (unusable) line = statusText(claude);
  else if (status) line = claudeLine(status, order, current);

  return (
    <footer className={styles.footer}>
      <div className={styles.group}>
        {DETAILED_FOOTER_HINTS.map((hint) => (
          <span key={hint.label}>
            {hint.keys.map((key, i) => (
              <Fragment key={key}>
                {i > 0 && ' '}
                <Kbd>{key}</Kbd>
              </Fragment>
            ))}
            {` ${hint.label}`}
          </span>
        ))}
      </div>
      <div className={styles.group}>
        {line !== null && (
          <span className={styles.claude}>
            <span aria-hidden="true" className={cx(styles.square, unusable && styles.unusable)} />
            {line}
          </span>
        )}
        {status && <span className={styles.code}>{codeAtText(status.codeAt)}</span>}
      </div>
    </footer>
  );
}
