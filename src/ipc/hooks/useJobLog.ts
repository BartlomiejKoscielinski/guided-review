import { useEffect, useState } from 'react';
import { useIpc } from '../IpcContext';
import type { JobLogEvent } from '../types/JobLogEvent';
import type { LogLine } from '../types/LogLine';

/** The most lines the log panel keeps (M6 decision 10, `review/job_log.rs`). */
export const MAX_LOG_LINES = 500;

export interface JobLog {
  lines: LogLine[];
  /** Lines were cut: the panel shows only the last 500. */
  truncated: boolean;
  /** "Couldn't load the log. <reason>" once the stream failed. */
  error: string | null;
  /** How many times the log started over (`replace`): the panel jumps to the tail on each. */
  replaces: number;
}

const EMPTY: JobLog = { lines: [], truncated: false, error: null, replaces: 0 };

/** The log after `event`: started over on `replace`, else the new lines appended. */
export function applyLogEvent(log: JobLog, event: JobLogEvent): JobLog {
  const lines = event.replace ? event.lines : [...log.lines, ...event.lines];
  const truncated =
    (event.replace ? event.truncated : log.truncated || event.truncated) ||
    lines.length > MAX_LOG_LINES;
  return {
    lines: lines.length > MAX_LOG_LINES ? lines.slice(lines.length - MAX_LOG_LINES) : lines,
    truncated,
    error: null,
    replaces: event.replace ? log.replaces + 1 : log.replaces,
  };
}

/**
 * The streamed log of job `job` (F-20.5) while it is shown: `null` reads nothing (a job that did
 * not run). Picking another job or leaving the screen stops the stream.
 */
export function useJobLog(project: string, iid: number, job: number | null): JobLog {
  const ipc = useIpc();
  const [state, setState] = useState<{ job: number | null; log: JobLog }>({
    job: null,
    log: EMPTY,
  });
  useEffect(() => {
    if (job === null) return;
    const controller = new AbortController();
    const update = (next: (log: JobLog) => JobLog) => {
      setState((s) => ({ job, log: next(s.job === job ? s.log : EMPTY) }));
    };
    ipc
      .jobTrace(
        project,
        iid,
        job,
        (event) => {
          update((log) => applyLogEvent(log, event));
        },
        controller.signal,
      )
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        const reason = e instanceof Error ? e.message : String(e);
        update((log) => ({ ...log, error: `Couldn't load the log. ${reason}` }));
      });
    return () => {
      controller.abort();
    };
  }, [ipc, project, iid, job]);
  return state.job === job ? state.log : EMPTY;
}
