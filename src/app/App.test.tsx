import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIpc } from '../test/render';
import { App } from './App';

describe('App', () => {
  it('shows the version from app_health', async () => {
    renderWithIpc(<App />);
    expect(await screen.findByText('Version 0.1.0')).toBeInTheDocument();
  });

  it('shows the error message when app_health fails', async () => {
    renderWithIpc(<App />, {
      appHealth: () =>
        Promise.reject(Object.assign(new Error('Core not reachable.'), { name: 'IpcError' })),
    });
    expect(await screen.findByText('Core not reachable.')).toBeInTheDocument();
  });
});
