import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../test/renderApp';

// F-30.6 › App group: `?` lists every shortcut (Settings › Shortcuts, F-19.3) from any screen, and
// `Ctrl+Shift+O` opens the file S-06 shows in Rider (M4 decision 14).

describe('App shortcuts (F-30.6)', () => {
  it('F-30.6 ? opens Settings › Shortcuts', async () => {
    renderApp({ screen: 'S-01' });
    await screen.findByLabelText(/Paste a merge request link/);
    await userEvent.click(document.body);
    await userEvent.keyboard('{Shift>}?{/Shift}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Shortcuts' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent('Shortcuts');
  });

  it('F-30.6 ? in a text field types a question mark; with Ctrl held it does nothing', async () => {
    renderApp({ screen: 'S-01' });
    const field = await screen.findByLabelText(/Paste a merge request link/);
    await userEvent.type(field, 'why?');
    expect(field).toHaveValue('why?');
    await userEvent.click(document.body);
    await userEvent.keyboard('{Control>}?{/Control}');
    expect(screen.queryByRole('heading', { level: 1, name: 'Shortcuts' })).not.toBeInTheDocument();
    await userEvent.keyboard('?');
    expect(await screen.findByRole('heading', { level: 1, name: 'Shortcuts' })).toBeInTheDocument();
  });

  it('F-30.6 Ctrl+Shift+O on S-06 opens the shown file in Rider, as Open in Rider does', async () => {
    const calls: [string, number, string | undefined][] = [];
    renderApp(
      { screen: 'S-06' },
      {
        riderOpen: (file, line, session) => {
          calls.push([file, line, session]);
          return Promise.resolve();
        },
      },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Open in Rider' }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    const [byButton] = calls;
    expect(byButton?.[0]).not.toBe('');
    await userEvent.click(document.body);
    await userEvent.keyboard('{Control>}{Shift>}O{/Shift}{/Control}');
    await waitFor(() => {
      expect(calls).toEqual([byButton, byButton]);
    });
  });
});
