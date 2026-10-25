import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunPipelineConfirm } from './RunPipelineConfirm';

// F-20.3 decision (implement stage): while the MR head is read the strip names it as "…".
describe('the confirmation strip while the MR head is read (F-20.3)', () => {
  it('F-20.3 the SHA reads "…" and is busy until the head is known; Run pipeline waits', () => {
    render(<RunPipelineConfirm sha={null} onRun={() => undefined} onCancel={() => undefined} />);

    const dialog = screen.getByRole('alertdialog', { name: 'Run new pipeline' });
    expect(dialog).toHaveTextContent(/^Run a new merge request pipeline on …\?/);
    expect(within(dialog).getByText('…')).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByRole('button', { name: 'Run pipeline' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });
});
