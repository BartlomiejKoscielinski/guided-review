import type { MrRow } from '../../ipc/types/MrRow';
import type { PipelineState } from '../../ipc/types/PipelineState';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "12 min", "2 h", "1 d" (Start.dc.html rows). */
export function age(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso));
  if (ms < HOUR) return `${String(Math.max(1, Math.floor(ms / MINUTE)))} min`;
  if (ms < DAY) return `${String(Math.floor(ms / HOUR))} h`;
  return `${String(Math.floor(ms / DAY))} d`;
}

/** "Marta K." or "You" for my own MR. */
export function authorName(row: MrRow): string {
  return row.mine ? 'You' : row.author.name;
}

/** "+462", "−61" (minus sign), "16 files" / "1 file". */
export function sizeParts(row: MrRow): { add: string; del: string; files: string } {
  return {
    add: `+${String(row.additions)}`,
    del: `−${String(row.deletions)}`,
    files: `${String(row.files)} ${row.files === 1 ? 'file' : 'files'}`,
  };
}

/**
 * The note line (F-02.2) with " · plan is ready" when a plan is cached for the head (F-02.5);
 * just "plan is ready" without another note; `null` when neither applies.
 */
export function noteText(row: MrRow): string | null {
  const parts = [row.note, row.planReady ? 'plan is ready' : null].filter((part): part is string =>
    Boolean(part),
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** "pipeline passed" etc. (F-02.2). */
export function pipelineText(state: PipelineState): string {
  return `pipeline ${state}`;
}
