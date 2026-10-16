import { useId, useRef } from 'react';
import { capturedKeys, type CapturedKeys } from '../../app/shortcutCapture';
import type { Shortcut } from '../../app/shortcuts';
import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { Kbd } from '../../components/Kbd';
import styles from './Shortcuts.module.css';

export const CAPTURE_PROMPT = 'Press the new keys…';

export interface ShortcutRowProps {
  shortcut: Shortcut;
  /** The keys now: the user's change or the default. */
  keys: readonly string[];
  /** `Esc`'s row: its keys are shown, not a button (M4 decision 16). */
  fixed: boolean;
  /** The keys differ from the default: the row shows Reset. */
  changed: boolean;
  /** The row waits for new keys. */
  capturing: boolean;
  /** Why the last keys or Reset were refused ("Already used by Ask Claude."). */
  message: string | null;
  /** The saved settings aren't read yet: the keys can't be changed. */
  disabled: boolean;
  onStart: () => void;
  onCancel: () => void;
  /** A key or chord pressed while the row waits (not Tab, not a modifier alone). */
  onCapture: (captured: Exclude<CapturedKeys, { kind: 'pass' | 'ignore' }>) => void;
  onReset: () => void;
}

/**
 * One row of Settings › Shortcuts (Settings.dc.html): the label left, the keys right. The keys
 * are a button ("Change shortcut for <action>", F-19.7) that waits for the next key or chord and
 * then reads "Press the new keys…" instead of its keys until a key is taken, Esc cancels or focus
 * leaves it. A changed row shows Reset before them.
 */
export function ShortcutRow({
  shortcut,
  keys,
  fixed,
  changed,
  capturing,
  message,
  disabled,
  onStart,
  onCancel,
  onCapture,
  onReset,
}: ShortcutRowProps) {
  const messageId = useId();
  // The key that ended a capture must not press the button again on its keyup (Space).
  const swallowKeyUp = useRef(false);
  const keyBoxes = keys.map((key, i) => <Kbd key={`${String(i)}-${key}`}>{key}</Kbd>);
  return (
    <div className={styles.row}>
      <span className={styles.text}>
        <span>{shortcut.label}</span>
        {message !== null && (
          <span id={messageId} role="status" className={styles.message}>
            {message}
          </span>
        )}
      </span>
      <span className={styles.actions}>
        {changed && (
          <Button size={28} variant="ghost" onClick={onReset}>
            Reset
          </Button>
        )}
        {fixed ? (
          <span className={styles.keys}>{keyBoxes}</span>
        ) : (
          <button
            type="button"
            className={cx(styles.keys, styles.keysButton, capturing && styles.capturing)}
            aria-label={`Change shortcut for ${shortcut.label}`}
            aria-describedby={message === null ? undefined : messageId}
            disabled={disabled}
            onClick={capturing ? onCancel : onStart}
            onBlur={() => {
              if (capturing) onCancel();
            }}
            onKeyDown={(event) => {
              if (!capturing) return;
              const captured = capturedKeys(event.nativeEvent);
              if (captured.kind === 'pass') return;
              // The keys belong to the capture: no shortcut runs and the button isn't pressed.
              event.preventDefault();
              event.stopPropagation();
              if (captured.kind === 'ignore') return;
              swallowKeyUp.current = true;
              onCapture(captured);
            }}
            onKeyUp={(event) => {
              if (!swallowKeyUp.current) return;
              swallowKeyUp.current = false;
              event.preventDefault();
            }}
          >
            {capturing ? <span className={styles.prompt}>{CAPTURE_PROMPT}</span> : keyBoxes}
          </button>
        )}
      </span>
    </div>
  );
}
