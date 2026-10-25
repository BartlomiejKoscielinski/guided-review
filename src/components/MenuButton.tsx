import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, type ButtonSize } from './Button';
import { moveMenuFocus } from './menuFocus';
import styles from './MenuButton.module.css';

export interface MenuAction {
  /** Sentence case; the menu items are not uppercase. */
  label: string;
  onSelect: () => void;
  /** Shown but not choosable; `title` says why. */
  disabled?: boolean;
  title?: string;
}

export interface MenuButtonProps {
  /** The button's word ("More"). */
  label: string;
  /** The menu's accessible name. */
  menuLabel: string;
  actions: MenuAction[];
  size?: ButtonSize;
}

/** A ghost button that opens a small action menu below it (note card More). */
export function MenuButton({ label, menuLabel, actions, size = 34 }: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    root.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      close();
      return;
    }
    if (menu.current && moveMenuFocus(menu.current, event.key)) event.preventDefault();
  };

  return (
    <div ref={root} className={styles.root}>
      <Button
        variant="ghost"
        size={size}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        {label}
      </Button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={menuLabel}
          className={styles.menu}
          onKeyDown={onMenuKeyDown}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className={styles.item}
              disabled={action.disabled}
              title={action.title}
              onClick={() => {
                close();
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
