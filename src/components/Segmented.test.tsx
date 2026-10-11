import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LayoutSidebarIcon } from './icons';
import { Segmented, type SegmentedOption } from './Segmented';

type Layout = 'A' | 'B' | 'C';
const OPTIONS: SegmentedOption<Layout>[] = [
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
];

function Controlled({ options = OPTIONS }: { options?: SegmentedOption<Layout>[] }) {
  const [value, setValue] = useState<Layout>('A');
  return <Segmented label="Focus layout" options={options} value={value} onChange={setValue} />;
}

describe('Segmented', () => {
  it('is a radio group with the selected option checked', () => {
    render(<Controlled />);
    const group = screen.getByRole('radiogroup', { name: 'Focus layout' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'A' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'B' })).toHaveAttribute('aria-checked', 'false');
  });

  it('has one tab stop on the selected option', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'A' })).toHaveFocus();
    await user.tab();
    expect(document.body).toHaveFocus();
  });

  it('moves and selects with arrow keys, Home and End', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'B' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'B' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{End}');
    expect(screen.getByRole('radio', { name: 'C' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'A' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'C' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: 'A' })).toHaveFocus();
  });

  it('selects on click and skips disabled options', async () => {
    const user = userEvent.setup();
    render(
      <Controlled
        options={[
          { value: 'A', label: 'A' },
          { value: 'B', label: 'B', disabled: true },
          { value: 'C', label: 'C' },
        ]}
      />,
    );
    await user.click(screen.getByRole('radio', { name: 'C' }));
    expect(screen.getByRole('radio', { name: 'C' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'A' })).toHaveAttribute('aria-checked', 'true');
  });

  it('does not report a change when the selected option is clicked again', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Segmented label="Mode" options={OPTIONS} value="A" onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'A' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('names icon-only options by their label and shows their tooltip', () => {
    render(
      <Segmented
        label="Layout"
        size="bar"
        options={[
          {
            value: 'A',
            label: 'Sidebar layout (Ctrl+1)',
            title: 'Sidebar · Ctrl+1',
            icon: <LayoutSidebarIcon />,
          },
        ]}
        value="A"
        onChange={vi.fn()}
      />,
    );
    const option = screen.getByRole('radio', { name: 'Sidebar layout (Ctrl+1)' });
    expect(option).toHaveAttribute('title', 'Sidebar · Ctrl+1');
    expect(option.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
