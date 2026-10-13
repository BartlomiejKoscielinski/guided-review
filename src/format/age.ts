/**
 * "just now", "5 min ago", "2 h ago", "yesterday", "3 d ago" (docs/03 › Copy style: times as
 * "2 h ago"; one day is "yesterday" as in the mocks, e.g. Review.dc.html's thread).
 * Dates in the future (clock skew) count as just now.
 */
export function formatAge(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now.getTime() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 60) return `${String(days)} d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}
