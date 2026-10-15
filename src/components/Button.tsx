import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { KbdContext } from './KbdContext';
import { cx } from './cx';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'approve' | 'send' | 'claude' | 'neutral' | 'ghost';
export type ButtonSize = 28 | 30 | 34 | 36 | 38 | 40 | 42 | 44 | 46 | 50;

const FILLED: ReadonlySet<ButtonVariant> = new Set(['primary', 'approve', 'send', 'claude']);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon or `<Kbd>` hints are passed as children next to the label. */
  children: ReactNode;
  /** React 19: passed through to the button (focus after a note decision). */
  ref?: Ref<HTMLButtonElement>;
}

/** Design-system button: yellow primary, green approve, blue send, purple Claude, neutral, ghost. */
export function Button({
  variant = 'neutral',
  size = 34,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  const filled = FILLED.has(variant) && !rest.disabled;
  const classes = cx(
    styles.button,
    styles[`h${String(size)}`],
    styles[variant],
    filled && styles.filled,
    className,
  );
  return (
    <button type={type} className={classes} {...rest}>
      <KbdContext value={filled ? 'on-color' : 'default'}>{children}</KbdContext>
    </button>
  );
}
