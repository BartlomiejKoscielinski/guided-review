import {
  act,
  screen,
  waitFor,
  within,
  type BoundFunctions,
  type queries,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { renderApp } from '../../test/renderApp';

// F-26.4: S-10's commit panel after a fix (docs/plans/M7.md F-26.4, decisions 8 to 10;
// Author.dc.html `cStage`). Once Fix in Rider has seen the file change, the bottom of the main
// column shows <section role="region" aria-label="Commit and push"> with the words "Commit the
// fix", the file's name, a textbox "Commit message" prefilled WITHOUT Claude with "Address review
// on UploadWorker.cs:46" (decision 9: <file> is the file name, :<line> the thread's line), the
// button **Suggest** (the existing commit-message task, only on click), the switch
// "As a fixup of b71e3a0 “Retry in UploadWorker”" (default on) with its note, and **Commit**.
//
// The commit goes out as gitCommit(message, false, fixup, [path]): `fixup` is the FULL sha of the
// target (the mock's is b71e3a0… from Author.dc.html) or null/undefined with the switch off, and
// `[path]` is only the fixed file (decision 10).
//
// Locators the screen keeps:
//  - the region above; the textbox named "Commit message"; the checkbox whose accessible name is
//    exactly `As a fixup of b71e3a0 “Retry in UploadWorker”` (typographic quotes, as the mock);
//    buttons named exactly "Suggest" and "Commit" inside the region.
//  - the note is plain text inside the region (toHaveTextContent), the sha unformatted.
//  - a failed commit: role="alert" with the error message and a <details> "Hook output" (the
//    existing CommitFailure); a finished one: the text "Committed" and the short sha.

const IID = 480;
const PATH = 'src/App/Workers/UploadWorker.cs';
const DETECTED = 'Change detected from Rider. Commit it below.';
const MESSAGE = 'Address review on UploadWorker.cs:46';
const FIXUP_LABEL = /^As a fixup of b71e3a0 “Retry in UploadWorker”$/;
const NOTE_ON =
  'Marked as a fixup of b71e3a0. Fold it in with git rebase --autosquash before merging, or merge with Squash commits.';
const NOTE_OFF = 'Stays a separate commit.';
const COMMITTED = { sha: '9e1d4b7c2a5f8e0d3b6a9c1e4f7a0d2b5c8e1f40', shortSha: '9e1d4b7' };

type Scope = BoundFunctions<typeof queries>;
type FixWatch = IpcClient['fixWatch'];
type FixWatchEvent = Parameters<Parameters<FixWatch>[1]>[0];

interface Watch {
  emit: (event: FixWatchEvent) => void;
}

async function backend(
  over: {
    latencyMs?: number;
    gitCommit?: IpcClient['gitCommit'];
    claudeCommitMessage?: IpcClient['claudeCommitMessage'];
  } = {},
) {
  const base = createMockClient({ latencyMs: over.latencyMs ?? 0 });
  await base.repoPick();
  const watches: Watch[] = [];
  const fixWatch = vi.fn<FixWatch>((_file, onEvent) => {
    watches.push({ emit: onEvent });
    return Promise.resolve(() => undefined);
  });
  const gitCommit = vi.fn<IpcClient['gitCommit']>(
    over.gitCommit ?? (() => Promise.resolve(COMMITTED)),
  );
  const claudeCommitMessage = vi.fn<IpcClient['claudeCommitMessage']>(
    over.claudeCommitMessage ??
      (() => Promise.resolve('UploadWorker: exponential backoff, capped at 60 s')),
  );
  return {
    client: { ...base, fixWatch, gitCommit, claudeCommitMessage },
    watches,
    gitCommit,
    claudeCommitMessage,
  };
}

async function openAuthor(over?: Parameters<typeof backend>[0]) {
  const rec = await backend(over);
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: IID })));
  return { ...app, ...rec };
}

const card = () => screen.findByRole('region', { name: 'Thread' });
const panel = () => screen.findByRole('region', { name: 'Commit and push' });
const noPanel = () => screen.queryByRole('region', { name: 'Commit and push' });
const option = (name: RegExp) => {
  const found = within(screen.getByRole('listbox', { name: 'Threads' }))
    .getAllByRole('option')
    .find((o) => name.test(o.textContent));
  if (!found) throw new Error(`no thread option ${String(name)}`);
  return found;
};

/** Fix in Rider on Marta's thread, then the core reports the change. */
async function detectChange(ctx: Awaited<ReturnType<typeof openAuthor>>) {
  await userEvent.click(await within(await card()).findByRole('button', { name: 'Fix in Rider' }));
  await waitFor(() => {
    expect(ctx.watches).toHaveLength(1);
  });
  const watch = ctx.watches[0];
  if (!watch) throw new Error('no watch');
  act(() => {
    watch.emit({ kind: 'changed' });
  });
  await within(await card()).findByText(DETECTED);
  return within(await panel());
}

const commitButton = (p: Scope) => p.getByRole('button', { name: 'Commit' });
const messageBox = (p: Scope) => p.getByRole('textbox', { name: 'Commit message' });
const fixupSwitch = (p: Scope) => p.getByRole('checkbox', { name: FIXUP_LABEL });
const argsOf = (
  commit: { mock: { calls: readonly unknown[][] } },
  index = 0,
): readonly unknown[] => {
  const call = commit.mock.calls[index];
  if (!call) throw new Error('gitCommit was not called');
  return call;
};

describe('S-10 commit panel after a fix (F-26.4)', () => {
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

  it('F-26.4 the panel shows only once a change is detected, then offers “Commit the fix”', async () => {
    const ctx = await openAuthor();
    await card();
    expect(noPanel()).toBeNull();

    await userEvent.click(
      await within(await card()).findByRole('button', { name: 'Fix in Rider' }),
    );
    await waitFor(() => {
      expect(ctx.watches).toHaveLength(1);
    });
    expect(noPanel()).toBeNull();

    const watch = ctx.watches[0];
    if (!watch) throw new Error('no watch');
    act(() => {
      watch.emit({ kind: 'changed' });
    });
    const p = within(await panel());
    expect(p.getByText('Commit the fix')).toBeInTheDocument();
    expect(await panel()).toHaveTextContent('UploadWorker.cs');
  });

  it('F-26.4 the message is prefilled without Claude: “Address review on UploadWorker.cs:46”', async () => {
    const ctx = await openAuthor();
    const p = await detectChange(ctx);

    expect(messageBox(p)).toHaveValue(MESSAGE);
    expect(ctx.claudeCommitMessage).not.toHaveBeenCalled();
    expect(p.getByRole('button', { name: 'Suggest' })).toBeEnabled();
  });

  it('F-26.4 Suggest asks Claude only on click and replaces the message with the answer', async () => {
    const ctx = await openAuthor();
    const p = await detectChange(ctx);

    await userEvent.click(p.getByRole('button', { name: 'Suggest' }));

    await waitFor(() => {
      expect(messageBox(p)).toHaveValue('UploadWorker: exponential backoff, capped at 60 s');
    });
    expect(ctx.claudeCommitMessage).toHaveBeenCalledTimes(1);
  });

  it('F-26.4 a failed Suggest leaves the message as it was', async () => {
    const ctx = await openAuthor({
      claudeCommitMessage: () =>
        Promise.reject(
          new IpcError({
            code: 'CLAUDE_FAILED',
            message: 'Claude could not answer.',
            retryable: true,
          }),
        ),
    });
    const p = await detectChange(ctx);
    await userEvent.type(messageBox(p), ' now');

    await userEvent.click(p.getByRole('button', { name: 'Suggest' }));

    expect(await screen.findByText('Claude could not answer.')).toBeInTheDocument();
    expect(messageBox(p)).toHaveValue(`${MESSAGE} now`);
  });

  it('F-26.4 the fixup switch is on by default with the “Marked as a fixup of b71e3a0…” note', async () => {
    const p = await detectChange(await openAuthor());

    expect(fixupSwitch(p)).toBeChecked();
    expect(await panel()).toHaveTextContent(NOTE_ON);
    expect(await panel()).not.toHaveTextContent(NOTE_OFF);
  });

  it('F-26.4 switching the fixup off says “Stays a separate commit.”, switching it on restores the note', async () => {
    const p = await detectChange(await openAuthor());

    await userEvent.click(fixupSwitch(p));
    expect(fixupSwitch(p)).not.toBeChecked();
    expect(await panel()).toHaveTextContent(NOTE_OFF);
    expect(await panel()).not.toHaveTextContent('Marked as a fixup');
    // The label names the commit either way.
    expect(fixupSwitch(p)).toBeInTheDocument();

    await userEvent.click(fixupSwitch(p));
    expect(fixupSwitch(p)).toBeChecked();
    expect(await panel()).toHaveTextContent(NOTE_ON);
  });

  it('F-26.4 Commit with the switch on sends the typed message, the full target sha and only the fixed file', async () => {
    const ctx = await openAuthor();
    const p = await detectChange(ctx);
    await userEvent.clear(messageBox(p));
    await userEvent.type(messageBox(p), 'Backoff doubles and stops at 60 s.');

    await userEvent.click(commitButton(p));

    await waitFor(() => {
      expect(ctx.gitCommit).toHaveBeenCalledTimes(1);
    });
    const args = argsOf(ctx.gitCommit);
    expect(args[0]).toBe('Backoff doubles and stops at 60 s.');
    expect(args[1]).toBe(false);
    expect(args[2]).toEqual(expect.stringMatching(/^b71e3a0[0-9a-f]{33}$/));
    expect(args[3]).toEqual([PATH]);
  });

  it('F-26.4 Commit with the switch off sends no fixup target, still only the fixed file', async () => {
    const ctx = await openAuthor();
    const p = await detectChange(ctx);
    await userEvent.click(fixupSwitch(p));

    await userEvent.click(commitButton(p));

    await waitFor(() => {
      expect(ctx.gitCommit).toHaveBeenCalledTimes(1);
    });
    const args = argsOf(ctx.gitCommit);
    expect(args[0]).toBe(MESSAGE);
    expect(args[1]).toBe(false);
    expect(args[2] ?? null).toBeNull();
    expect(args[3]).toEqual([PATH]);
  });

  it('F-26.4 Commit needs a message', async () => {
    const ctx = await openAuthor();
    const p = await detectChange(ctx);
    expect(commitButton(p)).toBeEnabled();

    await userEvent.clear(messageBox(p));

    expect(commitButton(p)).toBeDisabled();
    await userEvent.click(commitButton(p));
    expect(ctx.gitCommit).not.toHaveBeenCalled();
  });

  it('F-26.4 a commit in flight cannot be sent twice', async () => {
    let finish: (value: typeof COMMITTED) => void = () => undefined;
    const ctx = await openAuthor({
      gitCommit: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const p = await detectChange(ctx);

    await userEvent.click(commitButton(p));
    await waitFor(() => {
      expect(ctx.gitCommit).toHaveBeenCalledTimes(1);
    });

    expect(commitButton(p)).toBeDisabled();
    await userEvent.click(commitButton(p));
    expect(ctx.gitCommit).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish(COMMITTED);
      await Promise.resolve();
    });
  });

  it('F-26.4 a committed fix shows “Committed” and the short sha instead of the form', async () => {
    const ctx = await openAuthor();
    const p = await detectChange(ctx);

    await userEvent.click(commitButton(p));

    const done = within(await panel());
    expect(await done.findByText('Committed')).toBeInTheDocument();
    expect(await panel()).toHaveTextContent(COMMITTED.shortSha);
    expect(done.queryByRole('button', { name: 'Commit' })).toBeNull();
    expect(done.queryByRole('textbox', { name: 'Commit message' })).toBeNull();
  });

  it('F-26.4 a rejecting hook shows its output, keeps the message and the switch, and Commit can be retried', async () => {
    const ctx = await openAuthor({
      gitCommit: () =>
        Promise.reject(
          new IpcError({
            code: 'GIT_FAILED',
            message: 'Commit failed. A hook rejected it.',
            detail: 'dotnet format --verify-no-changes\nUploadWorker.cs(46,1): error WHITESPACE',
            retryable: false,
          }),
        ),
    });
    const p = await detectChange(ctx);
    await userEvent.click(fixupSwitch(p));
    await userEvent.type(messageBox(p), ' (retry)');

    await userEvent.click(commitButton(p));

    const alert = await within(await panel()).findByRole('alert');
    expect(alert).toHaveTextContent('Commit failed. A hook rejected it.');
    expect(within(alert).getByText('Hook output')).toBeInTheDocument();
    expect(messageBox(p)).toHaveValue(`${MESSAGE} (retry)`);
    expect(fixupSwitch(p)).not.toBeChecked();
    await waitFor(() => {
      expect(commitButton(p)).toBeEnabled();
    });

    await userEvent.click(commitButton(p));
    await waitFor(() => {
      expect(ctx.gitCommit).toHaveBeenCalledTimes(2);
    });
  });

  it('F-26.4 never offers Commit before the fixup target is known, so a commit is not silently a plain one', async () => {
    // Every mock call takes a moment: the panel may wait for the target, but whenever Commit is
    // enabled the switch is there and on.
    const ctx = await openAuthor({ latencyMs: 60 });
    const p = await detectChange(ctx);

    await waitFor(
      () => {
        expect(commitButton(p)).toBeEnabled();
        expect(fixupSwitch(p)).toBeChecked();
      },
      { timeout: 3000 },
    );
    await userEvent.click(commitButton(p));
    await waitFor(() => {
      expect(ctx.gitCommit).toHaveBeenCalledTimes(1);
    });
    expect(argsOf(ctx.gitCommit)[2]).toEqual(expect.stringMatching(/^b71e3a0/));
  });

  it('F-26.4 the typed message and the switch survive picking another thread and coming back; the panel belongs to Marta’s thread', async () => {
    const ctx = await openAuthor();
    const p = await detectChange(ctx);
    await userEvent.clear(messageBox(p));
    await userEvent.type(messageBox(p), 'Backoff doubles.');
    await userEvent.click(fixupSwitch(p));

    await userEvent.click(option(/Piotr S\./));
    await screen.findByRole('button', { name: 'Open in Rider · line 36' });
    expect(noPanel()).toBeNull();

    await userEvent.click(option(/Marta K\./));
    const again = within(await panel());
    expect(messageBox(again)).toHaveValue('Backoff doubles.');
    expect(fixupSwitch(again)).not.toBeChecked();
    expect(ctx.gitCommit).not.toHaveBeenCalled();
  });
});
