import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import { renderApp } from '../../test/renderApp';

// F-26.4: Suggest on S-10 describes the fixed file the way Commit takes it (M7 decision 10), not
// the staged changes that S-06's Suggest reads: claudeCommitMessage(task, [path]).

const IID = 480;
const PATH = 'src/App/Workers/UploadWorker.cs';
const DETECTED = 'Change detected from Rider. Commit it below.';

type FixWatch = IpcClient['fixWatch'];
type FixWatchEvent = Parameters<Parameters<FixWatch>[1]>[0];

describe('S-10 Suggest after a fix (F-26.4)', () => {
  beforeEach(() => {
    // jsdom lays nothing out; give elements a size so a virtual list renders its rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('F-26.4 Suggest on S-10 asks Claude about the fixed file only, not the staged changes', async () => {
    const base = createMockClient({ latencyMs: 0 });
    await base.repoPick();
    const emits: ((event: FixWatchEvent) => void)[] = [];
    const fixWatch = vi.fn<FixWatch>((_file, onEvent) => {
      emits.push(onEvent);
      return Promise.resolve(() => undefined);
    });
    const claudeCommitMessage = vi.fn<IpcClient['claudeCommitMessage']>(() =>
      Promise.resolve('UploadWorker: exponential backoff, capped at 60 s'),
    );
    const app = renderApp({ screen: 'S-01' }, { ...base, fixWatch, claudeCommitMessage });
    await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: IID })));

    const card = within(await screen.findByRole('region', { name: 'Thread' }));
    await userEvent.click(await card.findByRole('button', { name: 'Fix in Rider' }));
    await waitFor(() => {
      expect(emits).toHaveLength(1);
    });
    act(() => {
      emits[0]?.({ kind: 'changed' });
    });
    await card.findByText(DETECTED);
    const panel = within(await screen.findByRole('region', { name: 'Commit and push' }));

    await userEvent.click(panel.getByRole('button', { name: 'Suggest' }));

    await waitFor(() => {
      expect(panel.getByRole('textbox', { name: 'Commit message' })).toHaveValue(
        'UploadWorker: exponential backoff, capped at 60 s',
      );
    });
    expect(claudeCommitMessage).toHaveBeenCalledTimes(1);
    expect(claudeCommitMessage).toHaveBeenCalledWith(expect.any(String), [PATH]);
  });
});
