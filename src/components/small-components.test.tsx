import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Kbd } from './Kbd';
import { ModelChip } from './ModelChip';
import { Square } from './Square';
import { StatusChip } from './StatusChip';
import { Tag } from './Tag';

describe('Tag', () => {
  it('shows its word in sentence case (uppercase comes from CSS)', () => {
    render(<Tag color="blue">You’re the author</Tag>);
    expect(screen.getByText('You’re the author')).toBeInTheDocument();
  });
});

describe('Square', () => {
  it('is decorative: the word next to it carries the meaning', () => {
    const { container } = render(<Square color="green" size={12} />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Kbd', () => {
  it('renders a kbd element', () => {
    render(<Kbd>Ctrl</Kbd>);
    expect(screen.getByText('Ctrl').tagName).toBe('KBD');
  });
});

describe('ModelChip', () => {
  it('shows model and effort and opens Settings › Claude', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ModelChip label="Sonnet 5.5 · medium" onOpen={onOpen} />);
    const chip = screen.getByRole('button', { name: 'Sonnet 5.5 · medium' });
    expect(chip).toHaveAttribute('title', 'Claude model and effort · Ctrl+,');
    await user.tab();
    expect(chip).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe('StatusChip', () => {
  it('is plain text without an action and a button with one', () => {
    const { rerender } = render(<StatusChip color="green" label="Pipeline passed" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Pipeline passed')).toBeInTheDocument();
    rerender(<StatusChip color="green" label="Pipeline passed" onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Pipeline passed' })).toBeInTheDocument();
  });
});
