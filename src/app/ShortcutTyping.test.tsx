import { renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../test/renderApp';
import { clientWithShortcuts } from '../test/shortcutSettings';
import { pathFor } from './routes';
import { useShortcutStore } from './shortcuts';
import { useRiderKey } from './useRiderKey';

// F-19.7: the App and Code actions can take a key without Ctrl, Alt or Win (`J`, `,`, `R`). In a
// text field such a key types, as `?` does, so the S-01 input, the comment composer and the Ask
// box keep every letter; outside a field the key does its action. Chords act from a field too.

const SOURCE = /Paste a merge request link/;

afterEach(() => {
  useShortcutStore.setState({ changed: {} });
});

describe('a changed key without Ctrl, Alt or Win types in a text field (F-19.7)', () => {
  it('F-19.7 a single-letter Open anything key types into the S-01 input and opens it from elsewhere', async () => {
    const app = renderApp({ screen: 'S-01' }, clientWithShortcuts({ openAnything: ['J'] }));
    const input = await screen.findByLabelText(SOURCE);
    await userEvent.click(input);
    await userEvent.keyboard('jaj');
    expect(input).toHaveValue('jaj');

    await app.router.navigate(pathFor({ screen: 'S-07', section: 'general' }));
    expect(await screen.findByRole('heading', { name: 'General', level: 1 })).toBeInTheDocument();
    await userEvent.click(document.body);
    await userEvent.keyboard('j');
    expect(await screen.findByLabelText(SOURCE)).toBeInTheDocument();
  });

  it('F-19.7 a comma for Settings types a comma in the S-01 input', async () => {
    renderApp({ screen: 'S-01' }, clientWithShortcuts({ settings: [','] }));
    const input = await screen.findByLabelText(SOURCE);
    await userEvent.click(input);
    await userEvent.keyboard('a,b');
    expect(input).toHaveValue('a,b');
    expect(screen.queryByRole('heading', { name: 'General', level: 1 })).toBeNull();
  });

  it('F-19.7 R for Open in Rider types in a field and opens Rider outside it', () => {
    useShortcutStore.setState({ changed: { rider: ['R'] } });
    const open = vi.fn();
    renderHook(() => {
      useRiderKey(open);
    });
    const field = document.createElement('textarea');
    document.body.append(field);
    const typed = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true });
    field.dispatchEvent(typed);
    expect(open).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);

    const pressed = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true });
    document.body.dispatchEvent(pressed);
    expect(open).toHaveBeenCalledTimes(1);
    expect(pressed.defaultPrevented).toBe(true);
    field.remove();
  });

  it('F-19.7 a chord for Open anything still acts from a text field', async () => {
    const app = renderApp({ screen: 'S-01' }, clientWithShortcuts({ openAnything: ['Ctrl', 'J'] }));
    await app.router.navigate(pathFor({ screen: 'S-07', section: 'general' }));
    expect(await screen.findByRole('heading', { name: 'General', level: 1 })).toBeInTheDocument();
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    await userEvent.keyboard('{Control>}j{/Control}');
    await waitFor(() => {
      expect(screen.getByLabelText(SOURCE)).toBeInTheDocument();
    });
    field.remove();
  });
});
