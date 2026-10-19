import { useRef, type KeyboardEvent } from 'react';
import { cx } from '../../components/cx';
import type { PipelineTab } from '../../ipc/types/PipelineTab';
import { tabSub } from './pipelineText';
import styles from './Pipeline.module.css';

export interface PipelineTabsProps {
  tabs: PipelineTab[];
  selected: number;
  onSelect: (id: number) => void;
  /** The element the selected tab's pipeline shows in. */
  controls: string;
}

/**
 * The MR's pipelines, newest first (F-20.1): ARIA tabs with a roving tabindex; the arrow keys
 * move and select, wrapping at both ends; Home and End jump to the first and the last.
 */
export function PipelineTabs({ tabs, selected, onSelect, controls }: PipelineTabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    const tab = next === null ? undefined : tabs[next];
    if (next === null || !tab) return;
    event.preventDefault();
    onSelect(tab.id);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label="Pipelines for this MR" className={styles.tabs}>
      {tabs.map((tab, index) => {
        const on = tab.id === selected;
        const sub = tabSub(tab);
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={controls}
            tabIndex={on ? 0 : -1}
            className={cx(styles.tab, on && styles.tabOn)}
            onClick={() => {
              onSelect(tab.id);
            }}
            onKeyDown={(event) => {
              move(event, index);
            }}
          >
            <span aria-hidden="true" className={cx(styles.dot, styles[`dot-${tab.status}`])} />
            <span className={styles.tabNum}>#{tab.number}</span>
            {sub !== '' && <span className={styles.tabSub}>{sub}</span>}
          </button>
        );
      })}
    </div>
  );
}
