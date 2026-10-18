import { formatSaved } from '../../format/saved';
import type { Source } from '../../ipc/types/Source';
import type { UnfinishedSession } from '../../ipc/types/UnfinishedSession';

/** The card's tag (Start.dc.html): `!471` of an MR, `local` of a self-review. */
export function sourceTag(source: Source): string {
  switch (source.kind) {
    case 'mr':
      return `!${String(source.iid)}`;
    case 'local':
      return 'local';
    case 'commits':
      return 'commit';
  }
}

const count = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * The card's progress line (F-04.1): "5 of 9 steps · 3 drafts" for an MR, "Self-review · 2 of 6
 * steps · saved yesterday 18:40" for local changes; commits show steps and when they were saved.
 * A "drafts only" session has no steps, so its card shows the draft count only: "3 drafts"
 * (F-12.7, M5 decision 15).
 */
export function progressLine(session: UnfinishedSession, now: Date): string {
  const drafts = count(session.drafts, 'draft', 'drafts');
  if (session.status === 'draftsOnly') return drafts;
  const steps = `${String(session.reviewedSteps)} of ${count(session.totalSteps, 'step', 'steps')}`;
  const saved = `saved ${formatSaved(session.updatedAt, now)}`;
  switch (session.source.kind) {
    case 'mr':
      return `${steps} · ${drafts}`;
    case 'local':
      return `Self-review · ${steps} · ${saved}`;
    case 'commits':
      return `${steps} · ${saved}`;
  }
}
