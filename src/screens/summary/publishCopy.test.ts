import { describe, expect, it } from 'vitest';
import { publishedText } from './publishCopy';

// F-12.5 banner copy beyond the locked cases: a summary alone (M5 decision 7) and a summary
// comment that didn't go out (M5 decision 9).

const SINGLE = 'The author got a single notification.';

describe('publishedText (F-12.5)', () => {
  it('F-12.5 a summary alone reads Published a summary', () => {
    expect(publishedText({ published: [], summary: true, failed: [] })).toBe(
      `Published a summary. ${SINGLE}`,
    );
  });

  it('F-12.5 a failed summary is named after the comments that went out, or alone', () => {
    const why = 'GitLab is unreachable';
    expect(
      publishedText({ published: ['a'], summary: false, failed: [], summaryFailed: why }),
    ).toBe('Published 1 comment. The summary failed: GitLab is unreachable.');
    expect(publishedText({ published: [], summary: false, failed: [], summaryFailed: why })).toBe(
      'The summary failed: GitLab is unreachable.',
    );
  });

  it('F-12.5 a failed summary after failed comments says too for the same reason, else its own', () => {
    const failed = [{ id: 'b', reason: 'GitLab is unreachable' }];
    expect(
      publishedText({
        published: ['a'],
        summary: false,
        failed,
        summaryFailed: 'GitLab is unreachable',
      }),
    ).toBe('Published 1 of 2. 1 failed: GitLab is unreachable. The summary failed too.');
    expect(
      publishedText({
        published: ['a'],
        summary: false,
        failed,
        summaryFailed: 'Note is too long',
      }),
    ).toBe(
      'Published 1 of 2. 1 failed: GitLab is unreachable. The summary failed: Note is too long.',
    );
  });
});
