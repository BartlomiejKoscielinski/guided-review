import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CopyChecklist } from './CopyChecklist';

describe('Copy as checklist', () => {
  it('F-17.4 says "Copied." once the checklist is on the clipboard', async () => {
    const user = userEvent.setup();
    render(<CopyChecklist text="- [ ] Cap the retries" />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    await user.click(screen.getByRole('button', { name: 'Copy as checklist' }));
    expect(await screen.findByText('Copied.')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe('- [ ] Cap the retries');
  });

  it('F-17.4 says "Couldn’t copy." when the clipboard refuses', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    render(<CopyChecklist text="- [ ] Cap the retries" />);
    await user.click(screen.getByRole('button', { name: 'Copy as checklist' }));
    expect(await screen.findByText('Couldn’t copy.')).toBeInTheDocument();
  });

  it('F-17.4 the status of an earlier copy goes away when the list changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CopyChecklist text="- [ ] One" />);
    await user.click(screen.getByRole('button', { name: 'Copy as checklist' }));
    expect(await screen.findByText('Copied.')).toBeInTheDocument();
    rerender(<CopyChecklist text={'- [ ] One\n- [ ] Two'} />);
    expect(screen.queryByText('Copied.')).toBeNull();
  });
});
