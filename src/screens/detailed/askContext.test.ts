import { describe, expect, it } from 'vitest';
import { askContextLabel } from './askContext';

const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';

describe('S-04 Ask box context (F-08.7)', () => {
  it('F-08.7 the context is the step, or the step with the selected lines', () => {
    expect(askContextLabel(4, null)).toBe('step 4');
    expect(askContextLabel(4, { file: VM, side: 'new', start: 49, end: 49 })).toBe('step 4 · L49');
    expect(askContextLabel(4, { file: VM, side: 'new', start: 57, end: 46 })).toBe(
      'step 4 · L46–L57',
    );
  });

  it('F-08.7 lines of the old side are marked "(old)", as the answer card marks them', () => {
    expect(askContextLabel(2, { file: VM, side: 'old', start: 12, end: 14 })).toBe(
      'step 2 · L12–L14 (old)',
    );
  });
});
