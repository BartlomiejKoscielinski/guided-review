import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import type { MrDescription } from '../../ipc/types/MrDescription';
import { renderApp } from '../../test/renderApp';

// F-27.2, M7 decision 16 while Claude writes: text typed into Title or Description during
// "Writing…" is never overwritten silently. When the answer arrives over such edits it waits
// behind "Replace your edits?": Replace applies it, Cancel drops it and keeps the typed text.

const WRITTEN: MrDescription = {
  title: 'Enable compiled bindings in app pages',
  description:
    '## What\nAdds x:DataType to 12 pages.\n\n## Why\nCompiled bindings fail at build time.\n\n## How to test\n1. Build Release.',
};

/** A run that answers only when the test releases it. */
function held() {
  let release: (result: MrDescription) => void = () => undefined;
  const claudeMrDescription = vi.fn<IpcClient['claudeMrDescription']>(
    () =>
      new Promise<MrDescription>((resolve) => {
        release = resolve;
      }),
  );
  return {
    claudeMrDescription,
    release: (result: MrDescription) => {
      release(result);
    },
  };
}

const titleBox = () => screen.findByRole('textbox', { name: 'Title' });
const descriptionBox = () => screen.findByRole('textbox', { name: 'Description' });
const question = () => screen.findByRole('alertdialog', { name: 'Replace your edits?' });

describe('S-11 typing while Claude writes (F-27.2, M7 decision 16)', () => {
  it('F-27.2 text typed during the Draft MR description run is kept: the answer waits behind Replace your edits?, Cancel drops it', async () => {
    const user = userEvent.setup();
    const run = held();
    const { router } = renderApp(
      { screen: 'S-06' },
      { claudeMrDescription: run.claudeMrDescription },
    );
    await act(async () => {
      await router.navigate(pathFor({ screen: 'S-11' }), { state: { draftDescription: true } });
    });
    await screen.findByRole('button', { name: 'Writing…' });
    const description = await descriptionBox();
    await user.type(description, 'my own note');
    const typed = (description as HTMLTextAreaElement).value;
    expect(typed).toContain('my own note');

    act(() => {
      run.release(WRITTEN);
    });
    const dialog = await question();
    expect(description).toHaveValue(typed);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(description).toHaveValue(typed);
    expect(await screen.findByRole('button', { name: 'Write with Claude' })).toBeEnabled();
    expect(screen.queryByText(/Drafted by Claude/)).toBeNull();
    expect(run.claudeMrDescription).toHaveBeenCalledTimes(1);
  });

  it('F-27.2 a title typed during Write with Claude keeps the answer pending; Replace applies it without a second run', async () => {
    const user = userEvent.setup();
    const run = held();
    renderApp({ screen: 'S-11' }, { claudeMrDescription: run.claudeMrDescription });
    const title = await titleBox();
    await waitFor(() => {
      expect(title).not.toHaveValue('');
    });
    await user.click(screen.getByRole('button', { name: 'Write with Claude' }));
    await user.type(title, ' mine');
    const typed = (title as HTMLInputElement).value;

    act(() => {
      run.release(WRITTEN);
    });
    const dialog = await question();
    expect(title).toHaveValue(typed);
    await user.click(within(dialog).getByRole('button', { name: 'Replace' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(title).toHaveValue(WRITTEN.title);
    expect(await descriptionBox()).toHaveValue(WRITTEN.description);
    expect(await screen.findByRole('button', { name: 'Shorter version' })).toBeEnabled();
    expect(screen.getByText('Drafted by Claude from 3 commits and the diff')).toBeInTheDocument();
    expect(run.claudeMrDescription).toHaveBeenCalledTimes(1);
  });
});
