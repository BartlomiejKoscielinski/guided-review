import { Button } from '../../components/Button';
import { ClaudeIcon } from '../../components/icons';
import type { ReactNode } from 'react';
import styles from './Changes.module.css';

export interface CommitPanelProps {
  message: string;
  onMessage: (message: string) => void;
  amend: boolean;
  onAmend: (amend: boolean) => void;
  stagedFiles: number;
  /** Why committing is impossible right now (merge in progress); disables Commit. */
  blockedReason: string | null;
  committing: boolean;
  onCommit: () => void;
  /** Claude writes a message from the staged diff (F-16.4). */
  suggesting: boolean;
  onSuggest: () => void;
  /** The green Created block, error blocks, Claude notices above the message. */
  top?: ReactNode;
  /** Notices under the Suggest button (Claude usage limit, F-18.7). */
  suggestNotice?: ReactNode;
}

/** S-06 Commit panel (F-16.4). */
export function CommitPanel(props: CommitPanelProps) {
  const summary = props.message.split('\n')[0] ?? '';
  const files = props.stagedFiles;
  const disabled =
    props.committing || props.blockedReason !== null || props.message.trim() === '' || files === 0;
  const label = `${props.amend ? 'Amend' : 'Commit'} · ${String(files)} ${files === 1 ? 'file' : 'files'}`;
  return (
    <aside className={styles.aside} aria-label="Commit">
      <h2 className={styles.commitHeading}>Commit</h2>
      {props.top}
      <div className={styles.messageBar}>
        <label htmlFor="commit-message" className={styles.messageLabel}>
          Message
        </label>
        <Button variant="claude" size={30} disabled={props.suggesting} onClick={props.onSuggest}>
          <ClaudeIcon />
          {props.suggesting ? 'Claude is writing…' : 'Suggest'}
        </Button>
      </div>
      {props.suggestNotice}
      <textarea
        id="commit-message"
        rows={8}
        className={styles.message}
        placeholder="Describe the change or ask Claude for a suggestion"
        value={props.message}
        onChange={(e) => {
          props.onMessage(e.target.value);
        }}
      />
      <div className={styles.counterRow}>
        <span>Summary line</span>
        <span className={summary.length > 72 ? styles.counterOver : styles.counter}>
          {summary.length}/72
        </span>
      </div>
      <label className={styles.amend}>
        <input
          type="checkbox"
          checked={props.amend}
          onChange={(e) => {
            props.onAmend(e.target.checked);
          }}
        />
        <span>Amend previous commit</span>
      </label>
      {props.blockedReason && <p className={styles.blocked}>{props.blockedReason}</p>}
      <Button
        variant="primary"
        size={50}
        className={styles.commitButton}
        disabled={disabled}
        onClick={props.onCommit}
      >
        {label}
      </Button>
      {/* Self-review comes with M3 (02 › S-06): a static placeholder until then. */}
      <button type="button" className={styles.reviewFirst}>
        Review with Claude first
      </button>
    </aside>
  );
}
