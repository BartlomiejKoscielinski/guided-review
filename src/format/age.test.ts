import { describe, expect, it } from 'vitest';
import { formatAge } from './age';

describe('formatAge', () => {
  const now = new Date('2026-10-12T12:00:00Z');
  it('uses short relative ages', () => {
    expect(formatAge('2026-10-12T11:59:40Z', now)).toBe('just now');
    expect(formatAge('2026-10-12T11:55:00Z', now)).toBe('5 min ago');
    expect(formatAge('2026-10-12T10:00:00+00:00', now)).toBe('2 h ago');
    expect(formatAge('2026-10-09T12:00:00Z', now)).toBe('3 d ago');
    expect(formatAge('2026-01-01T00:00:00Z', now)).toBe('2026-01-01');
    expect(formatAge('2026-10-12T13:00:00Z', now)).toBe('just now');
    expect(formatAge('garbage', now)).toBe('');
  });
});
