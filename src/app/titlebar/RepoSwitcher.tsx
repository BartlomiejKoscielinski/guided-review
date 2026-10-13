import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDownIcon } from '../../components/icons';
import { cx } from '../../components/cx';
import { useAddRepo, useRepos, useSwitchRepo } from '../../ipc/hooks/useRepos';
import styles from './parts.module.css';

export interface RepoSwitcherProps {
  name: string;
  path: string;
}

/** Moves focus between the menu's items with the arrow keys, Home and End. */
function moveFocus(menu: HTMLElement, key: string): boolean {
  const items = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const last = items.length - 1;
  const next: Partial<Record<string, number>> = {
    ArrowDown: at >= last ? 0 : at + 1,
    ArrowUp: at <= 0 ? last : at - 1,
    Home: 0,
    End: last,
  };
  const index = next[key];
  if (index === undefined) return false;
  items[index]?.focus();
  return true;
}

/**
 * Repository switcher on S-01 and S-06 (F-30.7): the configured repositories and
 * "Add repository…" (folder dialog). Switching changes the active repository of S-01 and S-06.
 */
export function RepoSwitcher({ name, path }: RepoSwitcherProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const repos = useRepos();
  const switchRepo = useSwitchRepo();
  const addRepo = useAddRepo();

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"], [role^="menuitem"]')?.focus();
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
    button.current?.focus();
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      close();
      return;
    }
    if (menu.current && moveFocus(menu.current, event.key)) event.preventDefault();
  };

  return (
    <div ref={root} className={styles.repoSwitcherRoot} data-no-drag>
      <button
        ref={button}
        type="button"
        className={styles.repoSwitcher}
        aria-label={`Repository ${name}, ${path}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <span className={styles.repoName}>{name}</span>
        <span className={styles.repoPath}>{path}</span>
        <ChevronDownIcon className={styles.chevron} />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Repositories"
          className={styles.repoMenu}
          onKeyDown={onMenuKeyDown}
        >
          {(repos.data ?? []).map((repo) => (
            <button
              key={repo.id}
              type="button"
              role="menuitemradio"
              aria-checked={repo.isActive}
              className={cx(styles.repoItem, repo.isActive && styles.repoItemActive)}
              onClick={() => {
                if (!repo.isActive) switchRepo.mutate(repo.id);
                close();
              }}
            >
              <span className={styles.repoName}>{repo.name}</span>
              <span className={styles.repoPath}>{repo.path}</span>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className={cx(styles.repoItem, styles.repoAdd)}
            onClick={() => {
              addRepo.mutate(undefined);
              close();
            }}
          >
            Add repository…
          </button>
        </div>
      )}
    </div>
  );
}
