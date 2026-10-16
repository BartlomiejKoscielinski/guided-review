import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { renderApp } from '../../test/renderApp';
import {
  changedShortcuts,
  clientWithShortcuts,
  type ChangedShortcuts,
} from '../../test/shortcutSettings';

// Settings › Shortcuts (S-07), F-19.7 and M4 decision 16: a row's keys are a button ("Change
// shortcut for <action>"); the next key or chord becomes the shortcut ("Press the new keys…", Esc
// cancels); a key in use shows "Already used by <action>." and nothing changes; a changed row shows
// Reset and Reset all appears once anything is changed; Esc and the text-editing chords can't be
// assigned and Esc itself can't be changed. Changes are saved at once as `ui.shortcuts`, only the
// changed ones. Where the keys then work (S-03, S-04, the footer, the hints) is in
// src/app/ShortcutOverrides.test.tsx and src/app/ShortcutHints.test.tsx.

const SHORTCUTS_SECTION = { screen: 'S-07', section: 'shortcuts' } as const;
const PROMPT = 'Press the new keys…';

/** Every row of the screen in order: its label and default keys (the mock's, F-19.3). */
const ROWS: readonly (readonly [string, readonly string[]])[] = [
  ['Next change', ['↓']],
  ['Previous change', ['↑']],
  ['Next file', ['→']],
  ['Previous file', ['←']],
  ['Mark file reviewed', ['Space']],
  ['Next note', ['N']],
  ['Add to drafts', ['D']],
  ['Dismiss note', ['X']],
  ['Comment on line', ['C']],
  ['Ask Claude', ['A']],
  ['Primary action (plan, re-review)', ['Enter']],
  ['Go to definition', ['F12']],
  ['Find usages', ['Shift', 'F12']],
  ['Open in Rider', ['Ctrl', 'Shift', 'O']],
  ['Open anything', ['Ctrl', 'K']],
  ['Settings', ['Ctrl', ',']],
  ['Switch Focus / Detailed', ['Ctrl', 'D']],
  ['Sidebar layout', ['Ctrl', '1']],
  ['Minimal layout', ['Ctrl', '2']],
  ['Guide layout', ['Ctrl', '3']],
  ['Close popover', ['Esc']],
  ['All shortcuts', ['?']],
];

const changeButton = (action: string) =>
  screen.getByRole('button', { name: `Change shortcut for ${action}` });

/** The keys on a row's button, one entry per key box. */
const keysOf = (action: string) =>
  Array.from(changeButton(action).querySelectorAll('kbd')).map((key) => key.textContent);

const hasLabel = (element: Element, label: string) =>
  Array.from(element.querySelectorAll('*')).some(
    (child) => child.childElementCount === 0 && child.textContent.trim() === label,
  );

/** The row of an action: the nearest ancestor of its keys button that also holds its label. */
function rowOf(action: string): HTMLElement {
  let element: HTMLElement | null = changeButton(action);
  while (element && !hasLabel(element, action)) element = element.parentElement;
  if (!element) throw new Error(`no row for ${action}`);
  return element;
}

/** A changed row's Reset button (`null` on a row that is not changed). */
const resetOf = (action: string) => within(rowOf(action)).queryByRole('button', { name: 'Reset' });

const resetAll = () => screen.queryByRole('button', { name: 'Reset all' });

const press = (keys: string) => userEvent.keyboard(keys);

/** The mock backend with `changed` saved, and a spy on every save. */
function backend(changed: ChangedShortcuts = {}) {
  const client = clientWithShortcuts(changed);
  const save = vi.spyOn(client, 'appSettingsSet');
  return { client, save };
}

async function openShortcuts(client: IpcClient) {
  renderApp(SHORTCUTS_SECTION, client);
  expect(await screen.findByRole('heading', { name: 'Shortcuts', level: 1 })).toBeInTheDocument();
  await screen.findByRole('button', { name: 'Change shortcut for Next note' });
}

/** What the mock has saved as changed shortcuts (`ui.shortcuts`). */
async function saved(client: IpcClient): Promise<unknown> {
  return changedShortcuts(await client.appSettingsGet());
}

describe('Settings › Shortcuts › changing a shortcut', () => {
  it('F-19.7 every row but Close popover has its keys as a button "Change shortcut for <action>"; nothing is reset yet', async () => {
    await openShortcuts(backend().client);
    const changeable = ROWS.filter(([label]) => label !== 'Close popover');
    expect(screen.getAllByRole('button', { name: /^Change shortcut for / })).toHaveLength(
      changeable.length,
    );
    for (const [label, keys] of changeable) expect(keysOf(label)).toEqual(keys);
    expect(screen.queryByRole('button', { name: /Close popover/ })).toBeNull();
    expect(screen.getByText('Esc', { selector: 'kbd' })).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /^Reset/ })).toHaveLength(0);
    expect(screen.queryByText(PROMPT)).toBeNull();
  });

  it('F-19.7 clicking the keys shows "Press the new keys…" on that row and Esc cancels it without a change', async () => {
    const { client, save } = backend();
    await openShortcuts(client);
    await userEvent.click(changeButton('Next note'));
    expect(within(rowOf('Next note')).getByText(PROMPT)).toBeInTheDocument();
    expect(screen.getAllByText(PROMPT)).toHaveLength(1);
    expect(changeButton('Next note')).toHaveFocus();

    await press('{Escape}');
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(keysOf('Next note')).toEqual(['N']);
    expect(resetOf('Next note')).toBeNull();
    expect(resetAll()).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Shortcuts', level: 1 })).toBeInTheDocument();
  });

  it('F-19.7 leaving the keys button ends the capture and the next key changes nothing', async () => {
    const { client, save } = backend();
    await openShortcuts(client);
    await userEvent.click(changeButton('Next note'));
    expect(screen.getByText(PROMPT)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('heading', { name: 'Shortcuts', level: 1 }));
    expect(screen.queryByText(PROMPT)).toBeNull();
    await press('m');
    expect(keysOf('Next note')).toEqual(['N']);
    expect(save).not.toHaveBeenCalled();
  });

  it('F-19.7 clicking the keys of another row moves the capture there', async () => {
    await openShortcuts(backend().client);
    await userEvent.click(changeButton('Next note'));
    await userEvent.click(changeButton('Ask Claude'));
    expect(screen.getAllByText(PROMPT)).toHaveLength(1);
    expect(within(rowOf('Ask Claude')).getByText(PROMPT)).toBeInTheDocument();
    expect(keysOf('Next note')).toEqual(['N']);
  });

  it('F-19.7 the next key becomes the shortcut, shows Reset on its row and is saved at once', async () => {
    const { client, save } = backend();
    await openShortcuts(client);
    await userEvent.click(changeButton('Next note'));
    await press('m');

    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(keysOf('Next note')).toEqual(['M']);
    expect(resetOf('Next note')).toBeInTheDocument();
    expect(resetOf('Ask Claude')).toBeNull();
    expect(keysOf('Ask Claude')).toEqual(['A']);
    expect(resetAll()).toBeInTheDocument();
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(1);
    });
    expect(await saved(client)).toEqual({ nextNote: ['M'] });
  });

  it('F-19.7 a chord becomes the shortcut as Ctrl, Shift, key; a modifier alone does not end the capture', async () => {
    const { client } = backend();
    await openShortcuts(client);
    await userEvent.click(changeButton('Ask Claude'));
    await press('{Control}');
    await press('{Shift}');
    expect(within(rowOf('Ask Claude')).getByText(PROMPT)).toBeInTheDocument();

    await press('{Control>}{Shift>}Y{/Shift}{/Control}');
    expect(keysOf('Ask Claude')).toEqual(['Ctrl', 'Shift', 'Y']);
    expect(resetOf('Ask Claude')).toBeInTheDocument();
    expect(await saved(client)).toEqual({ ask: ['Ctrl', 'Shift', 'Y'] });
  });

  it('F-19.7 Space is captured like any other key and is shown as Space', async () => {
    const { client } = backend();
    await openShortcuts(client);
    // Space is free once Mark file reviewed has left it.
    await userEvent.click(changeButton('Mark file reviewed'));
    await press('m');
    await userEvent.click(changeButton('Next note'));
    await press(' ');

    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(keysOf('Next note')).toEqual(['Space']);
    expect(await saved(client)).toEqual({ markFile: ['M'], nextNote: ['Space'] });
  });

  it('F-19.7 a key used by another action shows "Already used by <action>." and nothing changes; the capture goes on', async () => {
    const { client, save } = backend();
    await openShortcuts(client);
    await userEvent.click(changeButton('Next note'));
    await press('d');

    expect(screen.getByText('Already used by Add to drafts.')).toBeInTheDocument();
    expect(keysOf('Add to drafts')).toEqual(['D']);
    expect(resetOf('Add to drafts')).toBeNull();
    expect(resetOf('Next note')).toBeNull();
    expect(resetAll()).toBeNull();
    expect(save).not.toHaveBeenCalled();
    // Still waiting for a key that is free.
    expect(within(rowOf('Next note')).getByText(PROMPT)).toBeInTheDocument();

    await press('m');
    expect(screen.queryByText(/Already used by/)).toBeNull();
    expect(keysOf('Next note')).toEqual(['M']);
    expect(await saved(client)).toEqual({ nextNote: ['M'] });
  });

  it('F-19.7 Esc after a refused key cancels the capture and clears the message', async () => {
    const { client, save } = backend();
    await openShortcuts(client);
    await userEvent.click(changeButton('Next note'));
    await press('d');
    expect(screen.getByText('Already used by Add to drafts.')).toBeInTheDocument();

    await press('{Escape}');
    expect(screen.queryByText(/Already used by/)).toBeNull();
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(keysOf('Next note')).toEqual(['N']);
    expect(save).not.toHaveBeenCalled();
  });

  it('F-19.7 a chord in use is refused too and does not run its shortcut meanwhile', async () => {
    const { client, save } = backend();
    await openShortcuts(client);
    await userEvent.click(changeButton('Next note'));

    await press('{Control>}k{/Control}');
    expect(screen.getByText('Already used by Open anything.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Shortcuts', level: 1 })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Paste a merge request link/)).toBeNull();

    await press('{Shift>}{F12}{/Shift}');
    expect(screen.getByText('Already used by Find usages.')).toBeInTheDocument();
    await press('{F12}');
    expect(screen.getByText('Already used by Go to definition.')).toBeInTheDocument();
    await press('{Shift>}?{/Shift}');
    expect(screen.getByText('Already used by All shortcuts.')).toBeInTheDocument();
    expect(keysOf('Next note')).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });

  it.each(['c', 'v', 'x', 'a', 'z'])(
    "F-19.7 Ctrl+%s is a text-editing chord: it can't be assigned and nothing changes",
    async (letter) => {
      const { client, save } = backend();
      await openShortcuts(client);
      await userEvent.click(changeButton('Next note'));
      await press(`{Control>}${letter}{/Control}`);

      expect(
        screen.getByText(
          `Ctrl+${letter.toUpperCase()} is a text-editing shortcut and can't be assigned.`,
        ),
      ).toBeInTheDocument();
      expect(within(rowOf('Next note')).getByText(PROMPT)).toBeInTheDocument();
      expect(save).not.toHaveBeenCalled();

      await press('{Escape}');
      expect(keysOf('Next note')).toEqual(['N']);
      expect(resetAll()).toBeNull();
    },
  );

  it('F-19.7 the same chords with Shift or Alt added are not text-editing chords and can be assigned', async () => {
    const { client } = backend();
    await openShortcuts(client);
    await userEvent.click(changeButton('Next note'));
    await press('{Control>}{Shift>}C{/Shift}{/Control}');
    expect(keysOf('Next note')).toEqual(['Ctrl', 'Shift', 'C']);
    expect(await saved(client)).toEqual({ nextNote: ['Ctrl', 'Shift', 'C'] });
  });

  it('F-19.7 pressing the keys a row already has changes nothing; pressing the defaults of a changed row clears the change', async () => {
    const { client, save } = backend();
    await openShortcuts(client);
    await userEvent.click(changeButton('Next note'));
    await press('n');
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(screen.queryByText(/Already used by/)).toBeNull();
    expect(resetOf('Next note')).toBeNull();
    expect(save).not.toHaveBeenCalled();

    await userEvent.click(changeButton('Next note'));
    await press('m');
    expect(resetOf('Next note')).toBeInTheDocument();
    await userEvent.click(changeButton('Next note'));
    await press('n');
    expect(keysOf('Next note')).toEqual(['N']);
    expect(resetOf('Next note')).toBeNull();
    expect(resetAll()).toBeNull();
    await waitFor(() => {
      expect(save).toHaveBeenCalledTimes(2);
    });
    expect(await saved(client)).toEqual({});
  });

  it('F-19.7 Reset gives a changed row its default keys and keeps only the rest saved', async () => {
    const { client } = backend({ nextNote: ['M'], ask: ['Q'] });
    await openShortcuts(client);
    expect(keysOf('Next note')).toEqual(['M']);
    expect(keysOf('Ask Claude')).toEqual(['Q']);

    await userEvent.click(resetOf('Ask Claude') as HTMLElement);
    expect(keysOf('Ask Claude')).toEqual(['A']);
    expect(resetOf('Ask Claude')).toBeNull();
    expect(keysOf('Next note')).toEqual(['M']);
    expect(resetOf('Next note')).toBeInTheDocument();
    expect(resetAll()).toBeInTheDocument();
    await waitFor(async () => {
      expect(await saved(client)).toEqual({ nextNote: ['M'] });
    });

    await userEvent.click(resetOf('Next note') as HTMLElement);
    expect(keysOf('Next note')).toEqual(['N']);
    expect(resetAll()).toBeNull();
    await waitFor(async () => {
      expect(await saved(client)).toEqual({});
    });
  });

  it('F-19.7 Reset all shows once anything is changed and restores every default at once', async () => {
    const { client, save } = backend();
    await openShortcuts(client);
    expect(resetAll()).toBeNull();
    await userEvent.click(changeButton('Next note'));
    await press('m');
    await userEvent.click(changeButton('Open anything'));
    await press('{Control>}j{/Control}');
    expect(keysOf('Open anything')).toEqual(['Ctrl', 'J']);
    expect(resetAll()).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Reset' })).toHaveLength(2);

    await userEvent.click(resetAll() as HTMLElement);
    expect(keysOf('Next note')).toEqual(['N']);
    expect(keysOf('Open anything')).toEqual(['Ctrl', 'K']);
    expect(screen.queryAllByRole('button', { name: /^Reset/ })).toHaveLength(0);
    await waitFor(async () => {
      expect(await saved(client)).toEqual({});
    });
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('F-19.7 Reset is refused when its default keys now belong to another action', async () => {
    const { client } = backend({ nextNote: ['M'], ask: ['N'] });
    await openShortcuts(client);
    await userEvent.click(resetOf('Next note') as HTMLElement);

    expect(within(rowOf('Next note')).getByText('Already used by Ask Claude.')).toBeInTheDocument();
    expect(keysOf('Next note')).toEqual(['M']);
    expect(keysOf('Ask Claude')).toEqual(['N']);
    expect(await saved(client)).toEqual({ nextNote: ['M'], ask: ['N'] });

    await userEvent.click(resetOf('Ask Claude') as HTMLElement);
    await userEvent.click(resetOf('Next note') as HTMLElement);
    expect(screen.queryByText(/Already used by/)).toBeNull();
    expect(keysOf('Next note')).toEqual(['N']);
    expect(keysOf('Ask Claude')).toEqual(['A']);
  });

  it('F-19.7 changed shortcuts that were saved before are shown with Reset; an action the app does not have is ignored', async () => {
    await openShortcuts(backend({ nextNote: ['M'], noSuchAction: ['Z'], nextFile: [] }).client);
    expect(keysOf('Next note')).toEqual(['M']);
    expect(resetOf('Next note')).toBeInTheDocument();
    expect(keysOf('Next file')).toEqual(['→']);
    expect(resetOf('Next file')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Change shortcut for / })).toHaveLength(21);
    expect(screen.queryByText('Z', { selector: 'kbd' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Reset' })).toHaveLength(1);
  });

  it('F-19.7 only an action the app does not have is saved: nothing is shown as changed', async () => {
    await openShortcuts(backend({ noSuchAction: ['Z'] }).client);
    expect(screen.queryAllByRole('button', { name: /^Reset/ })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /^Change shortcut for / })).toHaveLength(21);
  });
});

describe('Settings › Shortcuts › while the saved settings load, fail to load or fail to save', () => {
  const failure = (message: string) =>
    new IpcError({ code: 'INTERNAL', message, retryable: false });

  it('F-19.7 while the saved settings load the rows show the defaults and their keys buttons are disabled', async () => {
    const client = clientWithShortcuts({ nextNote: ['M'] });
    renderApp(SHORTCUTS_SECTION, { ...client, appSettingsGet: () => new Promise(() => undefined) });
    expect(await screen.findByRole('heading', { name: 'Shortcuts', level: 1 })).toBeInTheDocument();
    const button = changeButton('Next note');
    expect(button).toBeDisabled();
    expect(keysOf('Next note')).toEqual(['N']);
    await userEvent.click(button);
    expect(screen.queryByText(PROMPT)).toBeNull();
  });

  it('F-19.7 when the saved settings cannot be read the section says why instead of showing keys the user did not choose', async () => {
    const message = 'The settings could not be read.';
    const client = clientWithShortcuts({});
    renderApp(SHORTCUTS_SECTION, {
      ...client,
      appSettingsGet: () => Promise.reject(failure(message)),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('heading', { name: 'Shortcuts', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Change shortcut for / })).toBeNull();
    expect(screen.queryByText('Next note')).toBeNull();
  });

  it('F-19.7 when a change cannot be saved the error shows and the row keeps its old keys', async () => {
    const message = 'The settings could not be saved.';
    const client = clientWithShortcuts({});
    await openShortcuts({ ...client, appSettingsSet: () => Promise.reject(failure(message)) });
    await userEvent.click(changeButton('Next note'));
    await press('m');

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(keysOf('Next note')).toEqual(['N']);
    expect(resetOf('Next note')).toBeNull();
    expect(resetAll()).toBeNull();
    expect(await saved(client)).toEqual({});
  });
});
