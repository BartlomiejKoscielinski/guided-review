import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../test/renderApp';
import { clientWithShortcuts } from '../../test/shortcutSettings';

// F-19.7, the implement-stage readings of how a capture ends besides a key and Esc: clicking the
// waiting keys again cancels it (the button toggles), and Tab moves focus on as usual, which ends
// it, so the keyboard is never trapped and Tab never becomes a shortcut.

const PROMPT = 'Press the new keys…';
const changeButton = (action: string) =>
  screen.getByRole('button', { name: `Change shortcut for ${action}` });

async function open() {
  const client = clientWithShortcuts({});
  const save = vi.spyOn(client, 'appSettingsSet');
  renderApp({ screen: 'S-07', section: 'shortcuts' }, client);
  await screen.findByRole('button', { name: 'Change shortcut for Next note' });
  return save;
}

const keysOf = (action: string) =>
  Array.from(changeButton(action).querySelectorAll('kbd')).map((key) => key.textContent);

describe('Settings › Shortcuts › ending a capture (F-19.7)', () => {
  it('F-19.7 clicking the waiting keys again cancels the capture without a change', async () => {
    const save = await open();
    await userEvent.click(changeButton('Next note'));
    expect(screen.getByText(PROMPT)).toBeInTheDocument();
    await userEvent.click(changeButton('Next note'));
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(keysOf('Next note')).toEqual(['N']);
    expect(save).not.toHaveBeenCalled();
  });

  it('F-19.7 Tab moves focus to the next keys and ends the capture; Tab is not taken as a shortcut', async () => {
    const save = await open();
    await userEvent.click(changeButton('Next note'));
    await userEvent.tab();
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(changeButton('Add to drafts')).toHaveFocus();
    expect(keysOf('Next note')).toEqual(['N']);
    expect(save).not.toHaveBeenCalled();
  });
});
