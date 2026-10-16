import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { useNavigate } from 'react-router';
import { pathFor } from '../../app/routes';
import { ShortcutKeys } from '../../app/ShortcutKeys';
import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { SearchIcon } from '../../components/icons';
import { useOpenSource, useSourceDetect } from '../../ipc/hooks/useSources';
import { useStartStore } from '../../state/start';
import { detectedLabel } from './detectedLabel';
import { useDebounced } from './useDebounced';
import styles from './Start.module.css';

/** Typing pause before the input is detected (F-01.2). */
export const DETECT_DEBOUNCE_MS = 250;

/**
 * S-01 hero (F-01.2–F-01.5): one input for an MR link, `!iid`, SHA, branch or path, the
 * detected type next to it, Start / Enter to open it, and the inline error under it.
 */
export function SourceHero() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const settled = useDebounced(trimmed, DETECT_DEBOUNCE_MS);
  const detect = useSourceDetect(settled);
  const open = useOpenSource();
  const focusPending = useStartStore((s) => s.focusPending);
  const focusTaken = useStartStore((s) => s.focusTaken);

  useEffect(() => {
    if (!focusPending) return;
    input.current?.focus();
    input.current?.select();
    focusTaken();
  }, [focusPending, focusTaken]);

  const current = settled === trimmed && trimmed !== '';
  const detected = current && detect.data ? detectedLabel(detect.data) : null;
  const openError = open.variables === trimmed ? open.error : null;
  const error = openError ?? (current ? detect.error : null);

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!trimmed || open.isPending) return;
    open.mutate(trimmed, {
      onSuccess: (opened) => {
        void navigate(pathFor(opened.route));
      },
    });
  };

  return (
    <section className={styles.hero}>
      <h1 className={styles.heroTitle}>What are we reviewing?</h1>
      <label htmlFor="source" className={styles.heroLabel}>
        Paste a merge request link, a commit SHA or a branch name. The type is detected for you.
      </label>
      <form className={styles.sourceRow} onSubmit={onSubmit}>
        <SearchIcon className={styles.sourceIcon} />
        <input
          ref={input}
          id="source"
          type="text"
          className={styles.sourceInput}
          value={value}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'source-error' : undefined}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
        {detected && (
          <span className={cx(styles.detected, styles[detected.color])}>{detected.text}</span>
        )}
        <Button type="submit" variant="primary" size={44} disabled={open.isPending}>
          Start <span className={styles.enter}>↵</span>
        </Button>
      </form>
      {error && (
        <p id="source-error" role="alert" className={styles.sourceError}>
          {error.message}
        </p>
      )}
      <span className={styles.heroHint}>
        <ShortcutKeys id="openAnything" /> opens this field from any screen.
      </span>
    </section>
  );
}
