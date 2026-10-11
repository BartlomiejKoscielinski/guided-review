import type { MouseEvent, ReactNode } from 'react';
import { LogoMarkIcon } from '../../components/icons';
import { cx } from '../../components/cx';
import { useWindowControls } from '../../ipc/hooks/useWindowControls';
import { CaptionButtons } from './CaptionButtons';
import styles from './TitleBar.module.css';

export interface TitleBarProps {
  /** Repository and context (e.g. `!482` and the MR title), after the logo. */
  context: ReactNode;
  /** Optional centered control (progress segments in Focus layout B). */
  center?: ReactNode;
  /** Screen controls before the caption buttons. */
  controls?: ReactNode;
  /** 14px instead of 10px between the controls (S-01). */
  wideControls?: boolean;
}

/** Elements inside the bar that keep their own mouse behaviour instead of moving the window. */
const INTERACTIVE = 'button, a, input, select, textarea, [role="radio"], [data-no-drag]';

/**
 * Custom title bar (F-30.1): 44px, draggable, double-click maximizes or restores. Window
 * actions go through the IPC client (`useWindowControls`).
 */
export function TitleBar({ context, center, controls, wideControls = false }: TitleBarProps) {
  const win = useWindowControls();

  const onMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
    if (event.detail === 2) win.toggleMaximize();
    else win.startDragging();
  };

  return (
    <header
      className={cx(styles.bar, center !== undefined && styles.withCenter)}
      data-testid="title-bar"
      onMouseDown={onMouseDown}
    >
      <div className={styles.left}>
        <span className={styles.logo} aria-hidden="true">
          <LogoMarkIcon />
        </span>
        {context}
      </div>
      {center !== undefined && <div className={styles.center}>{center}</div>}
      <div className={cx(styles.right, wideControls && styles.rightWide)}>
        {controls}
        <CaptionButtons
          maximized={win.maximized}
          onMinimize={win.minimize}
          onToggleMaximize={win.toggleMaximize}
          onClose={win.close}
        />
      </div>
    </header>
  );
}
