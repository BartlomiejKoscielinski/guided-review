import { SHORTCUT_GROUPS, SHORTCUTS } from '../../app/shortcuts';
import { cx } from '../../components/cx';
import { Kbd } from '../../components/Kbd';
import styles from './Settings.module.css';
import shortcutStyles from './Shortcuts.module.css';

/**
 * Settings › Shortcuts (Settings.dc.html): every shortcut of F-30.6 in the groups Review, Code,
 * App (F-19.3, M4 decision 3). Each group is a small heading over its own grid of the mock's
 * rows: label left, one key per box right.
 */
export function ShortcutsSection() {
  return (
    <div className={cx(styles.content, shortcutStyles.content)}>
      <h1 className={styles.h1}>Shortcuts</h1>
      {SHORTCUT_GROUPS.map((group) => {
        const headingId = `h-shortcuts-${group.toLowerCase()}`;
        return (
          <section key={group} aria-labelledby={headingId} className={shortcutStyles.group}>
            <h2 id={headingId} className={shortcutStyles.heading}>
              {group}
            </h2>
            <div className={shortcutStyles.grid}>
              {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                <div key={shortcut.label} className={shortcutStyles.row}>
                  <span>{shortcut.label}</span>
                  <span className={shortcutStyles.keys}>
                    {shortcut.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
