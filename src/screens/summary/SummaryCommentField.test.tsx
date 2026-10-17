import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import type { ClaudeTaskEvent } from '../../ipc/types/ClaudeTaskEvent';
import type { ErrorCode } from '../../ipc/types/ErrorCode';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-12.4: "Add a summary comment" on the Drafts tab of S-05 (SummaryDesk.dc.html, M5 decision 11).
// The checkbox sits under the drafts list; ticking it is the one action that runs the summary
// task (nothing runs in the background); the text area opens at once and stays editable while
// Claude writes: the label reads "Claude is writing a summary…", then "Suggested by Claude, edit
// as you like" (mock). Anything the reviewer types wins and the suggestion is dropped. A failed
// run says "Couldn't suggest a summary." with Retry and an empty area; Claude that can't be used
// at all (not found, not signed in) leaves the empty area without any label. The tick and the text
// are kept per session. The summary task is driven here by a client whose `claudeSummaryComment`
// finishes or fails when the test says so; the tick and the text go through the mock backend's
// `sessionSetSummary` / `sessionSummary`.
//
// Locators the screen keeps: the checkbox named "Add a summary comment" and the one text area of
// the Drafts tabpanel (its accessible name is its label), the button "Retry".

const MR_SESSION = 'mock-mr-session-1';
/** Commands that may run Claude or call GitLab; a restored S-05 calls none of them (F-30.4). */
const WORK = /^(review|gitlab|claude(?!Status$|Models$))/;

const RUNNING = 'Claude is writing a summary…';
const SUGGESTED = 'Suggested by Claude, edit as you like';
const FAILED = "Couldn't suggest a summary.";
const SUGGESTION =
  'Thanks, the offline queue approach looks good. Before merging: handle camera cancellation and cap retries in UploadWorker.';

const DRAFT_BODIES = [
  'PendingCount doesn’t refresh after the worker uploads.',
  'Retries have no upper limit. On a permanent 4xx the photo will be retried forever.',
];

/** The mock backend of an MR session whose plan is read and which holds `drafts` drafts. */
async function mrBackend(drafts = DRAFT_BODIES.length): Promise<IpcClient> {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  await base.reviewPlan(MR_SESSION, () => undefined);
  for (const body of DRAFT_BODIES.slice(0, drafts)) {
    await base.draftsCreate({
      sessionId: MR_SESSION,
      findingId: null,
      body,
      position: null,
      severity: 'q',
    });
  }
  return { ...base };
}

interface Run {
  /** Claude answers: the `done` event, then the call resolves. */
  finish: (summary: string) => void;
  /** Claude fails: the `failed` event, then the call rejects. */
  fail: (code: ErrorCode) => void;
}

/** `base` with a summary task that waits for the test; `runs` holds one entry per call. */
function controlled(base: IpcClient): { client: IpcClient; runs: Run[] } {
  const runs: Run[] = [];
  const client: IpcClient = {
    ...base,
    claudeSummaryComment: (
      _session,
      onEvent: (event: ClaudeTaskEvent<{ summary: string }>) => void,
    ) =>
      new Promise((resolve, reject) => {
        onEvent({ kind: 'queued' });
        onEvent({ kind: 'started' });
        runs.push({
          finish: (summary) => {
            onEvent({ kind: 'done', result: { summary } });
            resolve({ summary });
          },
          fail: (code) => {
            const error = { code, message: `Task failed: ${code}`, retryable: false };
            onEvent({ kind: 'failed', error });
            reject(new IpcError(error));
          },
        });
      }),
  };
  return { client, runs };
}

/** S-05 of the MR session, opened the way Finish review does (not restored on start). */
async function openSummary(client: IpcClient) {
  const app = renderApp({ screen: 'S-01' }, client);
  await act(() => app.router.navigate(`/session/${MR_SESSION}/summary`));
  return app;
}

const panel = () => screen.findByRole('tabpanel');
const tick = () =>
  within(screen.getByRole('tabpanel')).getByRole('checkbox', { name: 'Add a summary comment' });
const area = () => within(screen.getByRole('tabpanel')).getByRole('textbox');
const inPanel = () => within(screen.getByRole('tabpanel'));
const saved = (client: IpcClient) => client.sessionSummary(MR_SESSION);

/** Opens the summary on the Drafts tab and waits for its rows. */
async function openDrafts(client: IpcClient) {
  const app = await openSummary(client);
  await within(await panel()).findAllByRole('listitem');
  return app;
}

/** Ticks the box and waits for the run to have started. */
async function tickAndWait(runs: Run[]) {
  await userEvent.click(tick());
  await waitFor(() => {
    expect(runs).toHaveLength(1);
  });
}

describe('S-05 summary comment (F-12.4)', () => {
  it('F-12.4 the checkbox "Add a summary comment" sits under the drafts list, unticked, with no text area and no Claude run', async () => {
    const { client, runs } = controlled(await mrBackend());
    const rec = recordingClient(client);
    await openDrafts(rec.client);
    expect(tick()).not.toBeChecked();
    expect(tick()).toBeEnabled();
    expect(inPanel().queryByRole('textbox')).toBeNull();
    const rows = inPanel().getAllByRole('listitem');
    const last = rows[rows.length - 1] as HTMLElement;
    expect(last.compareDocumentPosition(tick()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Opening the summary runs nothing: only the tick does.
    expect(runs).toHaveLength(0);
    expect(rec.calls.filter((name) => /^claudeSummaryComment$/.test(name))).toEqual([]);
  });

  it('F-12.4 ticking runs the task once: the area opens at once and stays editable while the label reads "Claude is writing a summary…"', async () => {
    const { client, runs } = controlled(await mrBackend());
    await openDrafts(client);
    await tickAndWait(runs);
    expect(tick()).toBeChecked();
    const running = inPanel().getByRole('textbox', { name: RUNNING });
    expect(running).toHaveValue('');
    expect(running).toBeEnabled();
    expect(running).not.toHaveAttribute('readonly');
    expect(inPanel().queryByText(SUGGESTED)).toBeNull();
    expect(runs).toHaveLength(1);
  });

  it('F-12.4 the answer prefills the area and the label becomes "Suggested by Claude, edit as you like"', async () => {
    const { client, runs } = controlled(await mrBackend());
    await openDrafts(client);
    await tickAndWait(runs);
    act(() => {
      runs[0]?.finish(SUGGESTION);
    });
    const field = await inPanel().findByRole('textbox', { name: SUGGESTED });
    expect(field).toHaveValue(SUGGESTION);
    expect(field).toBeEnabled();
    expect(inPanel().queryByText(RUNNING)).toBeNull();
    expect(inPanel().queryByText(FAILED)).toBeNull();
    expect(inPanel().queryByRole('button', { name: 'Retry' })).toBeNull();
    // The tick, the text and that Claude wrote it are kept for the session.
    await waitFor(async () => {
      expect(await saved(client)).toEqual({ enabled: true, text: SUGGESTION, suggested: true });
    });
    expect(runs).toHaveLength(1);
  });

  it('F-12.4 what the reviewer types while Claude writes wins: the suggestion is dropped', async () => {
    const { client, runs } = controlled(await mrBackend());
    await openDrafts(client);
    await tickAndWait(runs);
    await userEvent.type(area(), 'Mine: please look at the retries.');
    act(() => {
      runs[0]?.finish(SUGGESTION);
    });
    await waitFor(() => {
      expect(inPanel().queryByText(RUNNING)).toBeNull();
    });
    expect(area()).toHaveValue('Mine: please look at the retries.');
    // The words are the reviewer's own now, not "Suggested by Claude".
    expect(inPanel().queryByText(SUGGESTED)).toBeNull();
    expect(inPanel().queryByText(FAILED)).toBeNull();
    await waitFor(async () => {
      expect(await saved(client)).toEqual({
        enabled: true,
        text: 'Mine: please look at the retries.',
        suggested: false,
      });
    });
  });

  it('F-12.4 editing the suggestion keeps the text and the label, saves it and runs Claude no more', async () => {
    const { client, runs } = controlled(await mrBackend());
    await openDrafts(client);
    await tickAndWait(runs);
    act(() => {
      runs[0]?.finish(SUGGESTION);
    });
    await inPanel().findByRole('textbox', { name: SUGGESTED });
    await userEvent.type(area(), ' And the banner.');
    expect(area()).toHaveValue(`${SUGGESTION} And the banner.`);
    expect(inPanel().getByRole('textbox', { name: SUGGESTED })).toBe(area());
    await waitFor(async () => {
      expect(await saved(client)).toEqual({
        enabled: true,
        text: `${SUGGESTION} And the banner.`,
        suggested: true,
      });
    });
    expect(runs).toHaveLength(1);
  });

  it.each(['CLAUDE_FAILED', 'CLAUDE_SCHEMA'] as const)(
    'F-12.4 a failed run (%s) says "Couldn\'t suggest a summary." with Retry and an empty area; Retry writes it again',
    async (code) => {
      const { client, runs } = controlled(await mrBackend());
      await openDrafts(client);
      await tickAndWait(runs);
      act(() => {
        runs[0]?.fail(code);
      });
      expect(await inPanel().findByText(FAILED)).toBeInTheDocument();
      expect(area()).toHaveValue('');
      expect(area()).toBeEnabled();
      expect(inPanel().queryByText(RUNNING)).toBeNull();
      expect(inPanel().queryByText(SUGGESTED)).toBeNull();
      expect(tick()).toBeChecked();

      await userEvent.click(inPanel().getByRole('button', { name: 'Retry' }));
      await waitFor(() => {
        expect(runs).toHaveLength(2);
      });
      expect(inPanel().getByRole('textbox', { name: RUNNING })).toHaveValue('');
      expect(inPanel().queryByText(FAILED)).toBeNull();
      expect(inPanel().queryByRole('button', { name: 'Retry' })).toBeNull();
      act(() => {
        runs[1]?.finish(SUGGESTION);
      });
      expect(await inPanel().findByRole('textbox', { name: SUGGESTED })).toHaveValue(SUGGESTION);
    },
  );

  it.each(['CLAUDE_NOT_FOUND', 'CLAUDE_NOT_SIGNED_IN'] as const)(
    'F-12.4 Claude that cannot be used (%s) leaves the area empty without a label, a failure line or Retry, and the reviewer writes on',
    async (code) => {
      const { client, runs } = controlled(await mrBackend());
      await openDrafts(client);
      await tickAndWait(runs);
      act(() => {
        runs[0]?.fail(code);
      });
      await waitFor(() => {
        expect(inPanel().queryByText(RUNNING)).toBeNull();
      });
      expect(area()).toHaveValue('');
      expect(area()).toBeEnabled();
      expect(inPanel().queryByText(SUGGESTED)).toBeNull();
      expect(inPanel().queryByText(FAILED)).toBeNull();
      expect(inPanel().queryByRole('button', { name: 'Retry' })).toBeNull();
      expect(tick()).toBeChecked();

      await userEvent.type(area(), 'Written by hand.');
      await waitFor(async () => {
        expect(await saved(client)).toEqual({
          enabled: true,
          text: 'Written by hand.',
          suggested: false,
        });
      });
      expect(runs).toHaveLength(1);
    },
  );

  it('F-12.4 unticking hides the area but keeps the text; ticking again shows it without a second run', async () => {
    const { client, runs } = controlled(await mrBackend());
    await openDrafts(client);
    await tickAndWait(runs);
    act(() => {
      runs[0]?.finish(SUGGESTION);
    });
    await inPanel().findByRole('textbox', { name: SUGGESTED });

    await userEvent.click(tick());
    expect(tick()).not.toBeChecked();
    expect(inPanel().queryByRole('textbox')).toBeNull();
    await waitFor(async () => {
      expect(await saved(client)).toEqual({ enabled: false, text: SUGGESTION, suggested: true });
    });

    await userEvent.click(tick());
    expect(area()).toHaveValue(SUGGESTION);
    expect(runs).toHaveLength(1);
  });

  it('F-12.4 the tick and the text come back when the summary is opened again, with no Claude, review or GitLab command', async () => {
    const { client, runs } = controlled(await mrBackend());
    const first = await openDrafts(client);
    await tickAndWait(runs);
    act(() => {
      runs[0]?.finish(SUGGESTION);
    });
    await inPanel().findByRole('textbox', { name: SUGGESTED });
    await userEvent.type(area(), ' Edited.');
    await waitFor(async () => {
      expect((await saved(client)).text).toBe(`${SUGGESTION} Edited.`);
    });
    first.unmount();

    // The app started again on S-05 (restored): the saved choice is read from this PC.
    const again = recordingClient(client);
    renderApp({ screen: 'S-05', sessionId: MR_SESSION }, again.client);
    await within(await panel()).findAllByRole('listitem');
    await waitFor(() => {
      expect(tick()).toBeChecked();
    });
    expect(await inPanel().findByRole('textbox', { name: SUGGESTED })).toHaveValue(
      `${SUGGESTION} Edited.`,
    );
    expect(again.calls.filter((name) => WORK.test(name))).toEqual([]);
    expect(runs).toHaveLength(1);
  });

  it('F-12.4 the summary comment belongs to the Drafts tab: the Threads tab has none, and it is as left when Drafts comes back', async () => {
    const { client, runs } = controlled(await mrBackend());
    await openDrafts(client);
    await tickAndWait(runs);
    act(() => {
      runs[0]?.finish(SUGGESTION);
    });
    await inPanel().findByRole('textbox', { name: SUGGESTED });

    await userEvent.click(screen.getByRole('tab', { name: /^Threads/ }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /^Threads/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    expect(screen.queryByRole('checkbox', { name: 'Add a summary comment' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: /^Drafts/ }));
    expect(tick()).toBeChecked();
    expect(area()).toHaveValue(SUGGESTION);
    expect(runs).toHaveLength(1);
  });

  it('F-12.4 a review without drafts still offers the summary comment on the Drafts tab (a summary alone can be published)', async () => {
    const { client, runs } = controlled(await mrBackend(0));
    await openSummary(client);
    // With nothing to publish the summary opens on Threads (M5 decision 5).
    await userEvent.click(await screen.findByRole('tab', { name: /^Drafts/ }));
    expect(await inPanel().findByText('No drafts yet.')).toBeInTheDocument();
    expect(tick()).not.toBeChecked();
    await tickAndWait(runs);
    act(() => {
      runs[0]?.finish(SUGGESTION);
    });
    expect(await inPanel().findByRole('textbox', { name: SUGGESTED })).toHaveValue(SUGGESTION);
  });
});
