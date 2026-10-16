import { useState } from 'react';
import type { CapturedKeys } from '../../app/shortcutCapture';
import {
  changedShortcutKeys,
  defaultKeys,
  FIXED_SHORTCUTS,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  sameKeys,
  shortcutKeys,
  type ChangedShortcutKeys,
  type ShortcutId,
} from '../../app/shortcuts';
import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { useSaveShortcuts, useSettings } from '../../ipc/hooks/useSettings';
import { ShortcutRow } from './ShortcutRow';
import styles from './Settings.module.css';
import shortcutStyles from './Shortcuts.module.css';

/** A refusal shown on its row. */
interface RowMessage {
  id: ShortcutId;
  text: string;
}

type Captured = Exclude<CapturedKeys, { kind: 'pass' | 'ignore' }>;

/** The map to save: only the changed shortcuts, as `ui.shortcuts` keeps them, without `except`. */
function toSaved(changed: ChangedShortcutKeys, except?: ShortcutId): Record<string, string[]> {
  const saved: Record<string, string[]> = {};
  for (const [id, keys] of Object.entries(changed)) if (id !== except) saved[id] = [...keys];
  return saved;
}

/**
 * Settings › Shortcuts (Settings.dc.html): every shortcut of F-30.6 in the groups Review, Code,
 * App (F-19.3, M4 decision 3). Each group is a small heading over its own grid of the mock's
 * rows: label left, one key per box right. The keys can be changed (F-19.7, M4 decision 16): a
 * row's keys are a button that takes the next key or chord; keys another action has are refused
 * ("Already used by <action>."), so nothing changes behind the user's back; Reset per changed row
 * and Reset all bring the defaults back. Changes are saved at once, only the changed ones.
 */
export function ShortcutsSection() {
  const settings = useSettings();
  const { save, error: saveError } = useSaveShortcuts();
  const [capturing, setCapturing] = useState<ShortcutId | null>(null);
  const [message, setMessage] = useState<RowMessage | null>(null);
  const data = settings.data;
  const changed = changedShortcutKeys(data?.ui.shortcuts);
  const anyChanged = Object.keys(changed).length > 0;

  const stop = () => {
    setCapturing(null);
    setMessage(null);
  };

  /** Gives `id` its new keys, or refuses them on its row when another action has them. */
  const assign = (id: ShortcutId, keys: readonly string[]): boolean => {
    const taken = SHORTCUTS.find(
      (other) => other.id !== id && sameKeys(shortcutKeys(other.id, changed), keys),
    );
    if (taken) {
      setMessage({ id, text: `Already used by ${taken.label}.` });
      return false;
    }
    const next = toSaved(changed, id);
    if (!sameKeys(keys, defaultKeys(id))) next[id] = [...keys];
    save(next);
    return true;
  };

  const capture = (id: ShortcutId, captured: Captured) => {
    if (captured.kind === 'cancel') {
      stop();
    } else if (captured.kind === 'refused') {
      setMessage({ id, text: captured.message });
    } else if (sameKeys(captured.keys, shortcutKeys(id, changed)) || assign(id, captured.keys)) {
      stop();
    }
  };

  const reset = (id: ShortcutId) => {
    stop();
    assign(id, defaultKeys(id));
  };

  const resetAll = () => {
    stop();
    save({});
  };

  if (settings.error && !data) {
    return (
      <div className={cx(styles.content, shortcutStyles.content)}>
        <h1 className={styles.h1}>Shortcuts</h1>
        <p role="alert" className={styles.error}>
          {settings.error.message}
        </p>
      </div>
    );
  }

  return (
    <div className={cx(styles.content, shortcutStyles.content)}>
      <div className={shortcutStyles.header}>
        <h1 className={styles.h1}>Shortcuts</h1>
        {anyChanged && <Button onClick={resetAll}>Reset all</Button>}
      </div>
      {saveError && (
        <p role="alert" className={styles.error}>
          {saveError.message}
        </p>
      )}
      {SHORTCUT_GROUPS.map((group) => {
        const headingId = `h-shortcuts-${group.toLowerCase()}`;
        return (
          <section key={group} aria-labelledby={headingId} className={shortcutStyles.group}>
            <h2 id={headingId} className={shortcutStyles.heading}>
              {group}
            </h2>
            <div className={shortcutStyles.grid}>
              {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                <ShortcutRow
                  key={shortcut.id}
                  shortcut={shortcut}
                  keys={shortcutKeys(shortcut.id, changed)}
                  fixed={FIXED_SHORTCUTS.has(shortcut.id)}
                  changed={shortcut.id in changed}
                  capturing={capturing === shortcut.id}
                  message={message?.id === shortcut.id ? message.text : null}
                  disabled={!data}
                  onStart={() => {
                    setMessage(null);
                    setCapturing(shortcut.id);
                  }}
                  onCancel={stop}
                  onCapture={(captured) => {
                    capture(shortcut.id, captured);
                  }}
                  onReset={() => {
                    reset(shortcut.id);
                  }}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
