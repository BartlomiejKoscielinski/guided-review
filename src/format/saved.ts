import { formatAge } from './age';

const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local midnight of `date`, so "yesterday" is the calendar day before, not 24 h ago. */
const midnight = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * When a session was saved, in local time (F-04.1): "yesterday 18:40" as in Start.dc.html for
 * the day before; today as "2 h ago" and older days as "3 d ago" (docs/03 › Copy style).
 */
export function formatSaved(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  // Math.round: a calendar day across a DST change is 23 or 25 hours long.
  const days = Math.round((midnight(now) - midnight(then)) / DAY_MS);
  if (days <= 0) return formatAge(iso, now);
  if (days === 1) return `yesterday ${pad(then.getHours())}:${pad(then.getMinutes())}`;
  if (days < 60) return `${String(days)} d ago`;
  return formatAge(iso, now);
}
