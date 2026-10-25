import { describe, expect, it } from 'vitest';
import { formatDuration } from './duration';

describe('formatDuration (F-20.1)', () => {
  it('F-20.1 reads seconds, minutes and hours as S-08 shows them', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(840)).toBe('14 min');
    expect(formatDuration(3900)).toBe('1 h 5 min');
    expect(formatDuration(7200)).toBe('2 h');
  });
});
