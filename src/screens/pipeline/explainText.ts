import type { JobExplanation } from '../../ipc/types/JobExplanation';

/** Decision 14's tag word. */
export function verdictLabel(e: JobExplanation): string {
  switch (e.verdict) {
    case 'causedByMr':
      return 'Caused by this MR';
    case 'alreadyFixed':
      return e.fixedInVersion === undefined
        ? 'Already fixed'
        : `Already fixed in version ${String(e.fixedInVersion)}`;
    case 'unrelated':
      return 'Unrelated';
    case 'flaky':
      return 'Flaky';
    case 'unknown':
      return 'Unknown';
  }
}
