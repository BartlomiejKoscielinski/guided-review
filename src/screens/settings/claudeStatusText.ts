import type { ClaudeStatus } from '../../ipc/types/ClaudeStatus';

/** "15:32" for a Unix time in seconds. */
export function clock(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The words of a status (02 › S-07 › Claude). */
export function statusText(status: ClaudeStatus): string {
  switch (status.state) {
    case 'signedIn':
      return 'Claude Code: signed in';
    case 'notSignedIn':
      return 'Claude Code: not signed in';
    case 'notFound':
      return 'Claude Code: not found';
    case 'tooOld':
      return 'Guided Review needs Claude Code 2.1.248 or later.';
    case 'limited':
      return status.resetsAt === undefined
        ? 'Claude usage limit reached'
        : `Claude usage limit reached · resets ${clock(status.resetsAt)}`;
    case 'failed':
      return status.detail ?? 'Claude Code: check failed';
    case 'checking':
      return 'Claude Code: checking…';
  }
}
