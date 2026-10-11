import type { ReactNode } from 'react';
import { cx } from '../../components/cx';
import type { DockArea } from '../routes';
import styles from './Dock.module.css';

export interface DockTileProps {
  area: DockArea;
  label: string;
  icon: ReactNode;
  active: boolean;
  /** Dimmed and inert, with the reason as tooltip (Review without a session). */
  dimmedReason?: string;
  title?: string;
  onSelect: () => void;
}

/** A 58px dock tile: icon and label; the active one is filled with its area color. */
export function DockTile({
  area,
  label,
  icon,
  active,
  dimmedReason,
  title,
  onSelect,
}: DockTileProps) {
  const dimmed = dimmedReason !== undefined;
  return (
    <button
      type="button"
      className={cx(styles.tile, styles[area])}
      aria-current={active ? 'page' : undefined}
      aria-disabled={dimmed || undefined}
      title={dimmedReason ?? title}
      data-area={area}
      onClick={() => {
        if (!dimmed) onSelect();
      }}
    >
      {icon}
      {label}
    </button>
  );
}
