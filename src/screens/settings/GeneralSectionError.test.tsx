import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IpcError } from '../../ipc/errors';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';

// Settings › General (F-19.1) when the saved settings cannot be read: the section says why instead
// of showing defaults the user did not choose.

describe('Settings › General when the settings cannot be read', () => {
  it('F-19.1 shows the error instead of the rows', async () => {
    const message = 'The settings could not be read.';
    const ipc = mockClient({
      appSettingsGet: () =>
        Promise.reject(new IpcError({ code: 'INTERNAL', message, retryable: false })),
    });
    renderApp({ screen: 'S-07', section: 'general' }, ipc);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('heading', { name: 'General', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Start in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Start with Windows' })).not.toBeInTheDocument();
  });
});
