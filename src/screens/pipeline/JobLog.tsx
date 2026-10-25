import { useLayoutEffect, useRef } from 'react';
import type { LogLine } from '../../ipc/types/LogLine';
import styles from './JobDetails.module.css';

/** The first line of a cut log (M6 decision 10). */
export const TRUNCATED_LINE = 'Showing the last 500 lines. Full log opens it in GitLab.';

/** How close to the bottom (px) still counts as following the tail. */
const TAIL_SLACK = 24;

export interface JobLogProps {
  lines: LogLine[];
  truncated: boolean;
  /** The job still runs: a cursor ends the log and the view follows the tail. */
  running: boolean;
  /** Bumped each time the log starts over: the view jumps to the tail again. */
  replaces: number;
}

/**
 * The job log of S-08 (F-20.5): plain text in monospace, one element per line with its kind
 * (`data-kind`, colored from tokens); never HTML. The view opens at the tail (where a failed
 * job's error is) and jumps there again on every `replace`; new lines keep it at the tail unless
 * the user scrolled up.
 */
export function JobLog({ lines, truncated, running, replaces }: JobLogProps) {
  const box = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useLayoutEffect(() => {
    following.current = true;
  }, [replaces]);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [lines, replaces]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight <= TAIL_SLACK;
  };

  return (
    <div
      ref={box}
      role="log"
      aria-label="Job log"
      tabIndex={0}
      className={styles.log}
      onScroll={onScroll}
    >
      {truncated && (
        <div data-kind="plain" className={styles.plain}>
          {TRUNCATED_LINE}
        </div>
      )}
      {lines.map((line, index) => (
        <div key={index} data-kind={line.kind} className={styles[line.kind]}>
          {line.text}
        </div>
      ))}
      {running && <span className={styles.cursor} aria-hidden="true" />}
    </div>
  );
}
