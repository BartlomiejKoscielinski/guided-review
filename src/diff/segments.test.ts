import { describe, expect, it } from 'vitest';
import { segments } from './segments';

describe('segments', () => {
  it('F-15.5 merges syntax tokens with intraline emphasis', () => {
    const text = 'catch (ex) when (a)';
    const tokens = [
      { text: 'catch', color: 'var(--shiki-token-keyword)' },
      { text: ' (ex) ', color: 'var(--shiki-foreground)' },
      { text: 'when', color: 'var(--shiki-token-keyword)' },
      { text: ' (a)', color: 'var(--shiki-foreground)' },
    ];
    const parts = segments(text, tokens, [{ start: 10, end: 19 }]);
    expect(parts.map((p) => p.text).join('')).toBe(text);
    expect(parts.filter((p) => p.emphasized).map((p) => p.text)).toEqual([' ', 'when', ' (a)']);
    expect(parts.find((p) => p.text === 'when')?.color).toBe('var(--shiki-token-keyword)');
  });

  it('works without tokens and ignores tokens that do not match the text', () => {
    expect(segments('abc', undefined, [])).toEqual([{ text: 'abc', emphasized: false }]);
    expect(segments('abc', [{ text: 'xyz', color: 'c' }], [{ start: 1, end: 2 }])).toEqual([
      { text: 'a', emphasized: false },
      { text: 'b', emphasized: true },
      { text: 'c', emphasized: false },
    ]);
  });
});
