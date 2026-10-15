import { describe, expect, it } from 'vitest';
import { formatSaved } from './saved';

// Local times, so the expectations hold in any time zone.
const at = (day: number, hours: number, minutes = 0) =>
  new Date(2026, 9, day, hours, minutes).toISOString();

describe('formatSaved', () => {
  const now = new Date(2026, 9, 14, 20, 0);

  it('F-04.1 the day before is "yesterday 18:40", by calendar day in local time', () => {
    expect(formatSaved(at(13, 18, 40), now)).toBe('yesterday 18:40');
    expect(formatSaved(at(13, 0, 5), now)).toBe('yesterday 00:05');
    expect(formatSaved(at(13, 23, 50), new Date(2026, 9, 14, 0, 10))).toBe('yesterday 23:50');
  });

  it('F-04.1 today is a short relative age, older days count days', () => {
    expect(formatSaved(at(14, 18, 0), now)).toBe('2 h ago');
    expect(formatSaved(at(14, 19, 59), now)).toBe('1 min ago');
    expect(formatSaved(at(12, 23, 0), new Date(2026, 9, 14, 0, 30))).toBe('2 d ago');
    expect(formatSaved(at(4, 9), now)).toBe('10 d ago');
    expect(formatSaved('garbage', now)).toBe('');
  });
});
