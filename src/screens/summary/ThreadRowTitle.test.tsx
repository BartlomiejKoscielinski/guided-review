import { within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VM, openSummary, rowOf, thread } from '../../test/threadRows';

// F-13.2: the first message keeps to one line (M5 plan); the part cut off is not lost, the whole
// message is the title of the line (implement-stage decision: the clamp needs a way to read the
// rest without leaving S-05, and a comment on the MR itself has no Show in code).

describe('S-05 Threads tab rows: the cut first message (F-13.2)', () => {
  it('F-13.2 the first message has its whole text as its title', async () => {
    const long = `${'The retry loop never gives up on a permanent failure. '.repeat(6)}End.`;
    await openSummary([
      thread({ id: 'd-1', body: long, at: { file: VM, line: 48 } }),
      thread({ id: 'd-g', body: 'Thanks for the quick turnaround on this one.' }),
    ]);
    const row = await rowOf(long);
    expect(within(row).getByText(long)).toHaveAttribute('title', long);
    const general = await rowOf('Thanks for the quick turnaround on this one.');
    expect(
      within(general).getByText('Thanks for the quick turnaround on this one.'),
    ).toHaveAttribute('title', 'Thanks for the quick turnaround on this one.');
  });
});
