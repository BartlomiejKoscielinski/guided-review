import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { IpcClient } from '../../ipc/client';
import type { MockOptions } from '../../ipc/mock';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';

const bar = () => within(screen.getByTestId('title-bar'));

function renderStart(options: MockOptions = {}, overrides: Partial<IpcClient> = {}) {
  return renderApp({ screen: 'S-01' }, mockClient(overrides, options));
}

describe('Claude activity spinner', () => {
  it('F-18.8 shows nothing while no Claude task runs or waits', async () => {
    renderStart();
    await bar().findByRole('button', { name: 'Claude Code signed in' });
    await waitFor(() => {
      expect(bar().queryByRole('status', { name: /Claude is working/ })).toBeNull();
    });
  });

  it('F-18.8 names the running tasks only when none wait', async () => {
    renderStart({ claude: { activity: { running: 2, waiting: 0 } } });
    const spinner = await bar().findByRole('status', { name: 'Claude is working: 2 running.' });
    expect(spinner).toHaveAttribute('title', 'Claude is working: 2 running.');
    expect(spinner.querySelector('svg')).not.toBeNull();
  });

  it('F-18.8 adds ", M waiting" when tasks wait', async () => {
    renderStart({ claude: { activity: { running: 1, waiting: 3 } } });
    const spinner = await bar().findByRole('status', {
      name: 'Claude is working: 1 running, 3 waiting.',
    });
    expect(spinner).toHaveAttribute('title', 'Claude is working: 1 running, 3 waiting.');
  });

  it('F-18.8 sits right of the Claude status chip', async () => {
    renderStart({ claude: { activity: { running: 1, waiting: 0 } } });
    const chip = await bar().findByRole('button', { name: 'Claude Code signed in' });
    const spinner = await bar().findByRole('status', { name: /Claude is working/ });
    expect(chip.compareDocumentPosition(spinner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('F-18.8 disappears when the queue becomes empty', async () => {
    let counts = { running: 1, waiting: 0 };
    renderStart({}, { claudeActivity: () => Promise.resolve({ ...counts }) });
    await bar().findByRole('status', { name: 'Claude is working: 1 running.' });
    counts = { running: 0, waiting: 0 };
    await waitFor(
      () => {
        expect(bar().queryByRole('status', { name: /Claude is working/ })).toBeNull();
      },
      { timeout: 6000 },
    );
  });
});
