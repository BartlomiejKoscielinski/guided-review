import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockClient, renderWithIpc } from '../../test/render';
import { TitleBar } from './TitleBar';

function setup() {
  const ipc = mockClient();
  const spies = {
    minimize: vi.spyOn(ipc, 'windowMinimize'),
    toggle: vi.spyOn(ipc, 'windowToggleMaximize'),
    close: vi.spyOn(ipc, 'windowClose'),
    drag: vi.spyOn(ipc, 'windowStartDragging'),
  };
  renderWithIpc(
    <TitleBar
      context={<span>mobile-app</span>}
      controls={<button type="button">Finish review</button>}
    />,
    ipc,
  );
  return spies;
}

describe('TitleBar', () => {
  it('F-30.1 shows logo, repository and context, then controls and caption buttons', () => {
    setup();
    const bar = screen.getByTestId('title-bar');
    expect(bar.querySelector('svg path')?.getAttribute('d')).toBe('M4 2v12M12 2v12M4 8h8');
    expect(screen.getByText('mobile-app')).toBeInTheDocument();
    const names = screen
      .getAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toEqual(['Finish review', 'Minimize', 'Maximize', 'Close']);
  });

  it('F-30.1 caption buttons minimize, maximize and close through the IPC client', async () => {
    const user = userEvent.setup();
    const spies = setup();
    await user.click(screen.getByRole('button', { name: 'Minimize' }));
    await user.click(screen.getByRole('button', { name: 'Maximize' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(spies.minimize).toHaveBeenCalledOnce();
    expect(spies.toggle).toHaveBeenCalledOnce();
    expect(spies.close).toHaveBeenCalledOnce();
  });

  it('F-30.1 maximize turns into Restore while the window is maximized', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Maximize' }));
    expect(await screen.findByRole('button', { name: 'Restore' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Maximize' })).toBeInTheDocument();
    });
  });

  it('F-30.1 pressing the bar starts a drag, double-click toggles maximize', () => {
    const spies = setup();
    const bar = screen.getByTestId('title-bar');
    fireEvent.mouseDown(screen.getByText('mobile-app'), { button: 0, detail: 1 });
    expect(spies.drag).toHaveBeenCalledOnce();
    fireEvent.mouseDown(bar, { button: 0, detail: 2 });
    expect(spies.toggle).toHaveBeenCalledOnce();
    fireEvent.mouseDown(bar, { button: 2, detail: 1 });
    expect(spies.drag).toHaveBeenCalledOnce();
  });

  it('F-30.1 controls in the bar do not start a drag', () => {
    const spies = setup();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Finish review' }), {
      button: 0,
      detail: 1,
    });
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Close' }), { button: 0, detail: 2 });
    expect(spies.drag).not.toHaveBeenCalled();
    expect(spies.toggle).not.toHaveBeenCalled();
  });

  it('F-30.1 caption buttons are not tab stops (Alt+F4 and Win+arrows cover them)', async () => {
    const user = userEvent.setup();
    setup();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Finish review' })).toHaveFocus();
    await user.tab();
    expect(document.body).toHaveFocus();
  });
});
