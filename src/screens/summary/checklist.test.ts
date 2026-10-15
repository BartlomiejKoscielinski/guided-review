import { describe, expect, it } from 'vitest';
import type { Draft } from '../../ipc/types/Draft';
import { checklistText, draftLocation, progressLine } from './checklist';

const draft = (patch: Partial<Draft>): Draft => ({
  id: 'd1',
  sessionId: 's1',
  findingId: null,
  body: 'Cap the retries',
  position: { file: 'src/UploadWorker.cs', side: 'new', line: 71 },
  severity: 'fix',
  include: true,
  publishedNoteId: null,
  error: null,
  stepId: null,
  ...patch,
});

describe('self-review summary text', () => {
  it('F-17.4 the progress line says "All N steps" or "k of N steps" and keeps one step singular', () => {
    expect(progressLine(6, 6)).toBe('All 6 steps reviewed.');
    expect(progressLine(4, 6)).toBe('4 of 6 steps reviewed.');
    expect(progressLine(0, 6)).toBe('0 of 6 steps reviewed.');
    expect(progressLine(1, 1)).toBe('All 1 step reviewed.');
    expect(progressLine(0, 1)).toBe('0 of 1 step reviewed.');
  });

  it('F-17.4 a note shows its path and line, a comment on the whole change shows nothing', () => {
    expect(draftLocation(draft({}))).toBe('src/UploadWorker.cs:71');
    expect(draftLocation(draft({ position: null }))).toBeNull();
  });

  it('F-17.4 the checklist keeps every note on one line, whatever line breaks the note has', () => {
    const text = checklistText([
      draft({ body: 'First line\r\n  second line\n\nthird' }),
      draft({ id: 'd2', body: 'On the change', position: null }),
    ]);
    expect(text).toBe(
      '- [ ] First line second line third (src/UploadWorker.cs:71)\n- [ ] On the change',
    );
    expect(checklistText([])).toBe('');
  });
});
