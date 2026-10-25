import { useRef } from 'react';
import { SpinnerIcon } from '../../components/icons';
import { ReplaceEditsConfirm } from './ReplaceEditsConfirm';
import type { MrText } from './useMrText';
import styles from './CreateMr.module.css';

export interface MrTextFieldsProps {
  text: MrText;
  /** Commits of the branch against the target, for the Claude label; unknown while counted. */
  commits: number | undefined;
}

const SLOT: Record<MrText['next'], string> = {
  normal: 'Write with Claude',
  short: 'Shorter version',
  long: 'Longer version',
};

/**
 * Title and Description of S-11 (F-27.2, CreateMR.dc.html): the description's regenerate slot is
 * one Claude button (Write with Claude, then the version the next click writes; Writing… while
 * it runs) and, once Claude has written, the label "Drafted by Claude from N commits and the diff".
 */
export function MrTextFields({ text, commits }: MrTextFieldsProps) {
  const slot = useRef<HTMLButtonElement>(null);
  const backToSlot = () => {
    slot.current?.focus();
  };

  return (
    <>
      <section className={styles.field}>
        <label htmlFor="mr-title" className={styles.label}>
          Title
        </label>
        <input
          id="mr-title"
          type="text"
          className={styles.title}
          value={text.title}
          onChange={(event) => {
            text.setTitle(event.target.value);
          }}
        />
      </section>

      <section className={styles.field}>
        <div className={styles.descriptionHead}>
          <label htmlFor="mr-description" className={styles.label}>
            Description
          </label>
          {text.written && commits !== undefined && (
            <span className={styles.drafted}>
              <span className={styles.claudeDot} aria-hidden="true" />
              {`Drafted by Claude from ${String(commits)} ${commits === 1 ? 'commit' : 'commits'} and the diff`}
            </span>
          )}
          <button
            ref={slot}
            type="button"
            className={styles.regenerate}
            disabled={text.busy}
            onClick={text.regenerate}
          >
            {text.busy && <SpinnerIcon size={12} className={styles.spinner} />}
            {text.busy ? 'Writing…' : SLOT[text.next]}
          </button>
        </div>
        {text.asking !== null && (
          <ReplaceEditsConfirm
            onReplace={text.replace}
            onCancel={() => {
              text.cancelReplace();
              backToSlot();
            }}
          />
        )}
        {text.error !== null && (
          <p className={styles.alert} role="alert">
            {text.error}
          </p>
        )}
        <textarea
          id="mr-description"
          rows={15}
          className={styles.description}
          value={text.description}
          onChange={(event) => {
            text.setDescription(event.target.value);
          }}
        />
      </section>
    </>
  );
}
