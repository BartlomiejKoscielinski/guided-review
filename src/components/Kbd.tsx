import { use, type ReactNode } from 'react';
import { cx } from './cx';
import { KbdContext } from './KbdContext';
import styles from './Kbd.module.css';

export interface KbdProps {
  children: ReactNode;
}

/** A keyboard key hint ("Ctrl", "K", "Space"). Adapts to filled buttons automatically. */
export function Kbd({ children }: KbdProps) {
  const surface = use(KbdContext);
  return <kbd className={cx(styles.kbd, surface === 'on-color' && styles.onColor)}>{children}</kbd>;
}
