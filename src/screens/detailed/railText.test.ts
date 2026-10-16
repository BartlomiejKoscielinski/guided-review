import { describe, expect, it } from 'vitest';
import type { Draft } from '../../ipc/types/Draft';
import { orderCaption, rowEnd, stepDrafts, stepMeta } from './railText';

// F-08.3: the rail's copy the mock doesn't show (decisions of the implement stage): the head's
// order name for File order and a dragged order, what a step row ends with, and which drafts it
// counts.

const draft = (
  id: string,
  stepId: string | null,
  publishedNoteId: number | null = null,
): Draft => ({
  id,
  sessionId: 'r1',
  findingId: null,
  body: `Comment ${id}`,
  position: null,
  severity: null,
  include: true,
  publishedNoteId,
  error: null,
  stepId,
});

describe('S-04 rail text (F-08.3)', () => {
  it('F-08.3 the head names every order, a dragged one as "your order"', () => {
    const order = { order: [] as string[], custom: false };
    expect(orderCaption({ ...order, strategy: 'contractToUi' })).toBe('contract → UI');
    expect(orderCaption({ ...order, strategy: 'testsFirst' })).toBe('tests first');
    expect(orderCaption({ ...order, strategy: 'fileOrder' })).toBe('file order');
    expect(orderCaption({ ...order, strategy: 'testsFirst', custom: true })).toBe('your order');
  });

  it('F-08.3 a step’s second line leaves out −0 and keeps one file singular', () => {
    expect(stepMeta('core', { files: 2, additions: 38, deletions: 0 })).toBe(
      'Core · 2 files · +38',
    );
    expect(stepMeta('app', { files: 1, additions: 18, deletions: 9 })).toBe(
      'App · 1 file · +18 −9',
    );
  });

  it('F-08.3 the current step ends with its open notes, else with its drafts like the others', () => {
    expect(rowEnd(true, 4, 1)).toEqual({ kind: 'notes', label: '4 notes' });
    expect(rowEnd(true, 1, 0)).toEqual({ kind: 'notes', label: '1 note' });
    // Every note decided, or the notes not there yet: the draft count.
    expect(rowEnd(true, 0, 2)).toEqual({ kind: 'drafts', count: 2, title: '2 drafts' });
    expect(rowEnd(true, undefined, 1)).toEqual({ kind: 'drafts', count: 1, title: '1 draft' });
    expect(rowEnd(true, 0, 0)).toBeNull();
    expect(rowEnd(false, undefined, 0)).toBeNull();
  });

  it('F-08.3 a step counts its drafts that are not on GitLab yet', () => {
    const drafts = [
      draft('d1', 's2'),
      draft('d2', 's2', 901),
      draft('d3', 's3'),
      draft('d4', null),
    ];
    expect(stepDrafts(drafts, 's2')).toBe(1);
    expect(stepDrafts(drafts, 's3')).toBe(1);
    expect(stepDrafts(drafts, 's4')).toBe(0);
  });
});
