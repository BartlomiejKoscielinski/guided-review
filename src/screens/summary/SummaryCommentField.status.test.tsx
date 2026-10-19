import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SummaryField } from '../../ipc/types/SummaryField';
import { SummaryCommentField } from './SummaryCommentField';
import type { SummaryComment, SummaryPhase } from './useSummaryComment';

// F-12.4, WCAG 2.2 AA 4.1.3 (Status Messages): ticking the box leaves focus on the checkbox, so a
// screen reader learns that Claude is writing, and later that the suggestion has arrived, only
// through a live region. The labels sit in one role="status" region that exists for as long as
// the box is ticked (also when it is empty), so the switch from "Claude is writing a summary…" to
// "Suggested by Claude, edit as you like" is a change inside a region the reader already watches.
// The failure line keeps its own role="alert".

const RUNNING = 'Claude is writing a summary…';
const SUGGESTED = 'Suggested by Claude, edit as you like';

const comment = (field: SummaryField, phase: SummaryPhase): SummaryComment => ({
  field,
  phase,
  error: null,
  toggle: () => undefined,
  edit: () => undefined,
  retry: () => undefined,
});

describe('SummaryCommentField status region', () => {
  it('F-12.4 announces the running state and then the suggestion in the same status region', () => {
    const { rerender } = render(
      <SummaryCommentField
        comment={comment({ enabled: true, text: '', suggested: false }, 'running')}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(RUNNING);
    expect(screen.getByRole('textbox', { name: RUNNING })).toBeInTheDocument();

    rerender(
      <SummaryCommentField
        comment={comment({ enabled: true, text: 'Looks good overall.', suggested: true }, 'idle')}
      />,
    );
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent(SUGGESTED);
    expect(status).not.toHaveTextContent(RUNNING);
    expect(screen.getByRole('textbox', { name: SUGGESTED })).toHaveValue('Looks good overall.');
  });

  it('F-12.4 keeps an empty status region while ticked without a label, none while unticked', () => {
    const { rerender } = render(
      <SummaryCommentField
        comment={comment({ enabled: true, text: 'My own words.', suggested: false }, 'idle')}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    expect(screen.getByRole('textbox', { name: 'Add a summary comment' })).toBeInTheDocument();

    rerender(
      <SummaryCommentField
        comment={comment({ enabled: true, text: '', suggested: false }, 'running')}
      />,
    );
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent(RUNNING);

    rerender(
      <SummaryCommentField
        comment={comment({ enabled: false, text: '', suggested: false }, 'idle')}
      />,
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('F-12.4 leaves the failure to its alert, outside the status region', () => {
    render(
      <SummaryCommentField
        comment={comment({ enabled: true, text: '', suggested: false }, 'failed')}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't suggest a summary.");
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
