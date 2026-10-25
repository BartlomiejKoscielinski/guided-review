import type { JobLogEvent } from '../types/JobLogEvent';
import type { JobRow } from '../types/JobRow';
import { jobLog } from './fixtures/pipelineLog';

/** How often the core re-reads a running job's trace (`review/job_log.rs`, plan M6). */
export const FOLLOW_MS = 3000;

/** A job of the mock pipelines with the pipeline and stage it belongs to. */
export interface FoundJob {
  row: JobRow;
  pipeline: number;
  stage: string;
}

/**
 * `jobTrace` of the mock backend (F-20.5) as `commands/job_trace.rs` streams it: a finished job's
 * whole log in one `done` event; a canceled job the first two lines it wrote; a running job starts
 * with two lines (Pipeline.dc.html) and grows by one new line every 3 s up to the line before its
 * last (the job keeps running in the mock), until `signal` stops it; a job that did not run has
 * no log. Settles when the stream ends.
 */
export function traceJob(
  job: FoundJob,
  onEvent: (event: JobLogEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const lines = jobLog(job.pipeline, job.stage, job.row.name);
  const send = (event: JobLogEvent) => {
    if (!signal?.aborted) onEvent(event);
  };
  switch (job.row.state) {
    case 'passed':
    case 'failed':
    case 'failedAllowed':
      send({ lines, replace: true, truncated: false, done: true });
      return Promise.resolve();
    case 'canceled':
      send({ lines: lines.slice(0, 2), replace: true, truncated: false, done: true });
      return Promise.resolve();
    case 'waiting':
    case 'manual':
    case 'skipped':
      send({ lines: [], replace: true, truncated: false, done: true });
      return Promise.resolve();
    case 'running':
      break;
  }
  send({ lines: lines.slice(0, 2), replace: true, truncated: false, done: false });
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    let shown = 2;
    const timer = setInterval(() => {
      const next = lines[shown];
      if (shown >= lines.length - 1 || !next) {
        // Nothing more until the job ends; the stream stays open until stopped.
        clearInterval(timer);
        return;
      }
      shown += 1;
      send({ lines: [next], replace: false, truncated: false, done: false });
    }, FOLLOW_MS);
    signal?.addEventListener(
      'abort',
      () => {
        clearInterval(timer);
        resolve();
      },
      { once: true },
    );
  });
}
