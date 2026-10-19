import { formatAge } from '../../format/age';
import { formatDuration } from '../../format/duration';
import type { PipelineHead } from '../../ipc/types/PipelineHead';
import type { PipelineState } from '../../ipc/types/PipelineState';
import type { PipelineTab } from '../../ipc/types/PipelineTab';

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
