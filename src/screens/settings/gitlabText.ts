import type { GitlabStatus } from '../../ipc/types/GitlabStatus';

const DAY_MS = 86_400_000;

/** `gitlab.local` from `https://gitlab.local`; the text itself when it isn't a URL. */
export function hostOf(server: string): string {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

/** The status line under the GitLab heading (02 › S-07). */
export function gitlabStatusText(status: GitlabStatus): string {
  if (status.state === 'connected' && status.user) {
    return `Signed in as ${status.user.username} on ${hostOf(status.server ?? '')}`;
  }
  if (status.state === 'failing' && status.problem) return status.problem.message;
  return 'Add your GitLab token';
}

/** Days from `today` to a `YYYY-MM-DD` date, counted in calendar days. */
function daysUntil(date: string, today: Date): number {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - start) / DAY_MS);
}

/** "expires in 41 days" / "expires in 1 day" / "expires today" / "expired" / "no expiry". */
export function expiryText(expiresAt: string | null, today: Date = new Date()): string {
  if (expiresAt == null) return 'no expiry';
  const days = daysUntil(expiresAt, today);
  if (days < 0) return 'expired';
  if (days === 0) return 'expires today';
  return days === 1 ? 'expires in 1 day' : `expires in ${String(days)} days`;
}

/** "scope api · expires in 41 days · stored in Windows Credential Manager". */
export function tokenMeta(status: GitlabStatus, today?: Date): string {
  const scope = status.scopes.length > 0 ? `scope ${status.scopes.join(', ')}` : null;
  return [scope, expiryText(status.expiresAt, today), 'stored in Windows Credential Manager']
    .filter((part): part is string => part !== null)
    .join(' · ');
}
