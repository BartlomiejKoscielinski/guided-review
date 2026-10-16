import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FINDINGS } from '../../ipc/mock/fixtures/review';
import type { Finding } from '../../ipc/types/Finding';
import { CodeNotes } from './CodeNotes';

// F-08.7: a decided note's status word in Code notes (Main.dc.html: "In drafts", "Dismissed");
// a self-review keeps notes to fix (M4 decision 12), so a kept one reads "To fix".

const [first, second, third] = FINDINGS as [Finding, Finding, Finding];
const decided: Finding[] = [
  { ...first, decision: 'draft' },
  { ...second, decision: 'dismissed' },
  { ...third, decision: 'open' },
];

function show(selfReview: boolean | undefined) {
  render(
    <CodeNotes
      sessionId="s"
      stepId="s4"
      findings={decided}
      focused={null}
      onPick={() => undefined}
      selfReview={selfReview}
    />,
  );
  return decided.map((f) =>
    within(screen.getByRole('button', { name: (n) => n.includes(f.title) })),
  );
}

describe('S-04 Code notes status (F-08.7)', () => {
  it('F-08.7 a drafted note reads "In drafts", a dismissed one "Dismissed", an open one nothing', () => {
    const [drafted, dismissed, open] = show(false);
    expect(drafted?.getByText('In drafts', { exact: true })).toBeInTheDocument();
    expect(dismissed?.getByText('Dismissed', { exact: true })).toBeInTheDocument();
    expect(open?.queryByText(/In drafts|Dismissed|To fix/)).toBeNull();
  });

  it('F-08.7 self-review: a kept note reads "To fix"', () => {
    const [kept] = show(true);
    expect(kept?.getByText('To fix', { exact: true })).toBeInTheDocument();
    expect(kept?.queryByText('In drafts')).toBeNull();
  });

  it('F-08.7 while the session is looked up a drafted note shows no status word', () => {
    const [drafted, dismissed] = show(undefined);
    expect(drafted?.queryByText(/In drafts|To fix/)).toBeNull();
    expect(dismissed?.getByText('Dismissed', { exact: true })).toBeInTheDocument();
  });
});
