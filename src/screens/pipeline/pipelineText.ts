import { formatAge } from '../../format/age';
import { formatDuration } from '../../format/duration';
import type { JobRow } from '../../ipc/types/JobRow';
import type { JobState } from '../../ipc/types/JobState';
import type { PipelineHead } from '../../ipc/types/PipelineHead';
import type { PipelineState } from '../../ipc/types/PipelineState';
import type { PipelineTab } from '../../ipc/types/PipelineTab';
import type { StageColumn } from '../../ipc/types/StageColumn';
import { IpcError } from '../../ipc/errors';

/** The status block's word (M6 decision 1: the app's PipelineState words; CSS uppercases). */
export const STATUS_WORD: Record<PipelineState, string> = {
  passed: 'Passed',
  failed: 'Failed',
  running: 'Running',
  waiting: 'Waiting',
  canceled: 'Canceled',
  skipped: 'Skipped',
  manual: 'Manual',
};

/** "1 allowed failure" / "2 allowed failures". */
export function allowedLabel(count: number): string {
  return `${String(count)} allowed failure${count === 1 ? '' : 's'}`;
}

/** A tab's second line: "version 3 · latest", "version 2", "latest" or nothing. */
export function tabSub(tab: PipelineTab): string {
  const parts = [tab.version === null ? null : `version ${String(tab.version)}`];
  if (tab.latest) parts.push('latest');
  return parts.filter((p) => p !== null).join(' · ');
}

/**
 * The end of the meta line: "version 3 · Marta K. · 2 h ago · 14 min"; "started by you" for the
 * user's own pipeline (decision 3), and only the parts GitLab gives (no duration while it runs).
 */
export function metaText(head: PipelineHead, now: Date = new Date()): string {
  const who = head.startedByMe ? 'started by you' : head.author;
  const age = head.startedAt === null ? '' : formatAge(head.startedAt, now);
  return [
    head.version === null ? null : `version ${String(head.version)}`,
    who,
    age === '' ? null : age,
    head.durationSecs === null ? null : formatDuration(head.durationSecs),
  ]
    .filter((p): p is string => p !== null && p !== '')
    .join(' · ');
}

/** A job's state in words, for screen readers and the details tag (F-20.2, Pipeline.dc.html). */
export const JOB_LABEL: Record<JobState, string> = {
  passed: 'Passed',
  failed: 'Failed',
  failedAllowed: 'Failed · allowed',
  running: 'Running',
  waiting: 'Waiting',
  manual: 'Manual',
  canceled: 'Canceled',
  skipped: 'Skipped',
};

const two = (n: number) => String(n).padStart(2, '0');

/** A job's duration as a clock: "0:48", "6:12", "1:02:05". */
export function jobClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return hours > 0
    ? `${String(hours)}:${two(minutes)}:${two(secs)}`
    : `${String(minutes)}:${two(secs)}`;
}

/** The right end of a job row: its duration, "running", "manual", "skipped" or nothing. */
export function jobMeta(row: JobRow): string {
  switch (row.state) {
    case 'running':
      return 'running';
    case 'manual':
      return 'manual';
    case 'skipped':
      return 'skipped';
    case 'waiting':
    case 'canceled':
      return '';
    case 'passed':
    case 'failed':
    case 'failedAllowed':
      return row.durationSecs === null ? '' : jobClock(row.durationSecs);
  }
}

/** A job in these states never ran, so it has no log to read (Pipeline.dc.html's showLog). */
export function hasJobLog(state: JobState): boolean {
  return state !== 'waiting' && state !== 'manual' && state !== 'skipped';
}

/** The details' meta (F-20.5): "<stage> stage · <clock>", "… · started just now" while running,
 * "… · allowed to fail". */
export function jobDetailsMeta(row: JobRow, stage: string): string {
  const parts = [`${stage} stage`];
  if (row.state === 'running') parts.push('started just now');
  else if (row.durationSecs !== null && hasJobLog(row.state))
    parts.push(jobClock(row.durationSecs));
  if (row.state === 'failedAllowed') parts.push('allowed to fail');
  const text = parts.join(' · ');
  // GitLab's stage names are lower case; the line starts like a sentence ("Test stage").
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "1 job" / "3 jobs". */
export function jobCount(count: number): string {
  return `${String(count)} job${count === 1 ? '' : 's'}`;
}

/**
 * The state a stage's dot shows, as Pipeline.dc.html derives it: running wins, then a failure
 * that is not allowed; all manual, all skipped or manual, canceled among passed, all waiting or
 * manual; otherwise passed (an allowed failure keeps the stage green).
 */
export function stageState(states: JobState[]): JobState {
  const all = (pred: (s: JobState) => boolean) => states.every(pred);
  if (states.includes('running')) return 'running';
  if (states.includes('failed')) return 'failed';
  if (all((s) => s === 'manual')) return 'manual';
  if (all((s) => s === 'skipped' || s === 'manual')) return 'skipped';
  if (all((s) => s === 'canceled' || s === 'passed') && states.includes('canceled')) {
    return 'canceled';
  }
  if (all((s) => s === 'waiting' || s === 'manual')) return 'waiting';
  return 'passed';
}

/** The job a pipeline opens on: the first that did not pass, else the first (F-20.2). */
export function firstJobToShow(columns: StageColumn[]): string | null {
  const rows = columns.flatMap((c) => c.jobs);
  return (rows.find((j) => j.state !== 'passed') ?? rows[0])?.name ?? null;
}

/** The pipeline has a job Retry failed jobs restarts: failed, failed-allowed or canceled (F-20.4). */
export function hasRetryableJob(columns: StageColumn[]): boolean {
  return columns.some((c) =>
    c.jobs.some(
      (j) => j.state === 'failed' || j.state === 'failedAllowed' || j.state === 'canceled',
    ),
  );
}

/**
 * GitLab's reason when a write was refused with 403 (M6 decision 9): its own words (`detail`)
 * when it sent some, else the error's message; null for any other failure.
 */
export function refusalOf(error: unknown): string | null {
  if (!(error instanceof IpcError) || error.code !== 'GITLAB_FORBIDDEN') return null;
  return error.detail ?? error.message;
}
