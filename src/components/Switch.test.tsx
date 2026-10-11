import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from './Switch';

function Controlled({ initial = false }: { initial?: boolean }) {
  const [on, setOn] = useState(initial);
  return (
    <>
      <span id="row-label">Start with Windows</span>
      <Switch checked={on} onChange={setOn} labelledBy="row-label" />
    </>
  );
}

describe('Switch', () => {
  it('is a switch named by its row label', () => {
    render(<Controlled />);
    const sw = screen.getByRole('switch', { name: 'Start with Windows' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('toggles with click, Space and Enter', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const sw = screen.getByRole('switch');
    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await user.keyboard(' ');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.keyboard('{Enter}');
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('is reachable with Tab', async () => {
    const user = userEvent.setup();
    render(<Controlled initial />);
    await user.tab();
    expect(screen.getByRole('switch')).toHaveFocus();
  });

  it('uses the label prop when there is no visible label', () => {
    render(<Switch checked onChange={() => undefined} label="Weekends" />);
    expect(screen.getByRole('switch', { name: 'Weekends' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
