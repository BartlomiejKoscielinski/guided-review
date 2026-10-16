import type { AnalysisStatus } from '../../ipc/types/AnalysisStatus';
import type { ClaudeStatus } from '../../ipc/types/ClaudeStatus';
import type { CodeAt } from '../../ipc/types/CodeAt';

/** Ascending step numbers as ranges: "5–6", "5, 7–8". */
function ranges(numbers: number[]): string {
  const groups: [number, number][] = [];
  for (const n of numbers) {
    const last = groups.at(-1);
    if (last && n === last[1] + 1) last[1] = n;
    else groups.push([n, n]);
  }
  return groups.map(([a, b]) => (a === b ? String(a) : `${String(a)}–${String(b)}`)).join(', ');
}

const steps = (numbers: number[]) =>
  `${numbers.length === 1 ? 'step' : 'steps'} ${ranges(numbers)}`;

/**
 * The footer's Claude line (M4 decision 9): the steps after `current` whose analysis is ready,
 * the steps being analyzed and the failed ones, numbered in the reader's `order`; "Claude: idle"
 * with none of them.
 */
export function claudeLine(
  status: AnalysisStatus,
  order: readonly string[],
  current: string | undefined,
): string {
  const numbers = (ids: string[]) =>
    [...new Set(ids.map((id) => order.indexOf(id) + 1).filter((n) => n > 0))].sort((a, b) => a - b);
  const now = current === undefined ? 0 : order.indexOf(current) + 1;
  const ready = numbers(status.ready).filter((n) => n > now);
  const running = numbers(status.running);
  const failed = numbers(status.failed);
  const parts = [
    ready.length > 0 ? `${steps(ready)} ready` : null,
    running.length > 0 ? `analyzing ${ranges(running)}` : null,
    failed.length > 0 ? `${steps(failed)} failed` : null,
  ].filter((part) => part !== null);
  return `Claude: ${parts.length > 0 ? parts.join(', ') : 'idle'}`;
}

/** Which code Claude reads (M4 decision 10): "worktree @ a3f9c12", "working tree". */
export function codeAtText(codeAt: CodeAt): string {
  switch (codeAt.kind) {
    case 'worktree':
      return `worktree @ ${codeAt.sha.slice(0, 7)}`;
    case 'repository':
      return `repository @ ${codeAt.sha.slice(0, 7)}`;
    case 'workingTree':
      return 'working tree';
  }
}

/** Claude Code can't run tasks: the footer shows its status words instead (M4 decision 9). */
export const isUnusable = (status: ClaudeStatus | undefined): status is ClaudeStatus =>
  status !== undefined && status.state !== 'signedIn' && status.state !== 'checking';
