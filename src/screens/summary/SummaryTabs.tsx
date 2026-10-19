import { useRef, type KeyboardEvent } from 'react';
import { cx } from '../../components/cx';
import type { SummaryTab } from './openingTab';
import styles from './Summary.module.css';

export interface SummaryTabsProps {
  /** The selected tab (M5 decision 5 picks the first one). */
  tab: SummaryTab;
  onSelect: (tab: SummaryTab) => void;
  /** Every draft of the session; null while unknown (being read, or the read failed). */
  drafts: number | null;
  /** The MR's open threads; null while unknown (restored start, being read, or failed). */
  openThreads: number | null;
  /** Id of the selected tab's panel (`aria-controls`). */
  panelId: string;
  /** Prefix of the tab ids: a tab's id is `${idPrefix}-${tab}`. */
  idPrefix: string;
}

const TABS: readonly { id: SummaryTab; label: string }[] = [
  { id: 'drafts', label: 'Drafts' },
  { id: 'threads', label: 'Threads' },
];

/**
 * Drafts N and Threads N open (F-12.2, SummaryDesk.dc.html): ARIA tabs named Comments. Only the
 * selected tab is in the Tab order; ArrowLeft / ArrowRight select the neighbour and wrap, Home /
 * End the ends. A count that isn't known is left out, never shown as 0.
 */
export function SummaryTabs({
  tab,
  onSelect,
  drafts,
  openThreads,
  panelId,
  idPrefix,
}: SummaryTabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const count = (id: SummaryTab): string | null => {
    if (id === 'drafts') return drafts === null ? null : String(drafts);
    return openThreads === null ? null : `${String(openThreads)} open`;
  };

  const select = (index: number) => {
    const target = TABS[index];
    if (!target) return;
    refs.current[index]?.focus();
    onSelect(target.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = TABS.length - 1;
    let target: number;
    switch (event.key) {
      case 'ArrowRight':
        target = index === last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
        target = index === 0 ? last : index - 1;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    select(target);
  };

  return (
    <div role="tablist" aria-label="Comments" className={styles.tabs}>
      {TABS.map((t, index) => {
        const selected = t.id === tab;
        const n = count(t.id);
        return (
          <button
            key={t.id}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-${t.id}`}
            aria-selected={selected}
            aria-controls={selected ? panelId : undefined}
            tabIndex={selected ? 0 : -1}
            className={cx(styles.tab, selected && styles.tabOn)}
            onClick={() => {
              onSelect(t.id);
            }}
            onKeyDown={(event) => {
              onKeyDown(event, index);
            }}
          >
            {t.label}
            {n !== null && (
              <>
                {' '}
                <span className={styles.tabCount}>{n}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
