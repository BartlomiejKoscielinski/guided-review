import { CloseIcon, MaximizeIcon, MinimizeIcon, RestoreIcon } from '../../components/icons';
import { cx } from '../../components/cx';
import styles from './TitleBar.module.css';

export interface CaptionButtonsProps {
  maximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

/**
 * Windows caption buttons, 46px wide (docs/02 › Shell). They are not tab stops: Alt+F4 and
 * Win+arrows do the same from the keyboard. Maximize turns into Restore while maximized.
 */
export function CaptionButtons({
  maximized,
  onMinimize,
  onToggleMaximize,
  onClose,
}: CaptionButtonsProps) {
  return (
    <div className={styles.captions}>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Minimize"
        className={styles.caption}
        onClick={onMinimize}
      >
        <MinimizeIcon />
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label={maximized ? 'Restore' : 'Maximize'}
        className={styles.caption}
        onClick={onToggleMaximize}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        className={cx(styles.caption, styles.close)}
        onClick={onClose}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
