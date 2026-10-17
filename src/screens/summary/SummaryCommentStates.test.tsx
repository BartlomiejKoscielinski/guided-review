import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import type { ClaudeTaskEvent } from '../../ipc/types/ClaudeTaskEvent';
import type { ErrorCode } from '../../ipc/types/ErrorCode';
import { renderApp } from '../../test/renderApp';

// F-12.4 states that M5 decision 11 leaves open, as the implementation reads them: words typed
// after a failed run replace the failure line and Retry; emptying Claude's words drops the
// "Suggested by Claude" label; ticking again with an empty area asks Claude again (with words in
// it, it doesn't); without a visible label the area is named by the checkbox.

const MR_SESSION = 'mock-mr-session-1';
const SUGGESTED = 'Suggested by Claude, edit as you like';
const FAILED = "Couldn't suggest a summary.";
const SUGGESTION = 'Looks good. Cap the retries in UploadWorker before merging.';

interface Run {
  finish: (summary: string) => void;
  fail: (code: ErrorCode) => void;
}

async function backend(): Promise<{ client: IpcClient; runs: Run[] }> {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  await base.reviewPlan(MR_SESSION, () => undefined);
  await base.draftsCreate({
    sessionId: MR_SESSION,
    findingId: null,
    body: 'Retries have no upper limit.',
    position: null,
    severity: 'q',
  });
  const runs: Run[] = [];
  const client: IpcClient = {
    ...base,
    claudeSummaryComment: (
      _session,
      onEvent: (event: ClaudeTaskEvent<{ summary: string }>) => void,
    ) =>
      new Promise((resolve, reject) => {
        runs.push({
          finish: (summary) => {
            onEvent({ kind: 'done', result: { summary } });
            resolve({ summary });
          },
          fail: (code) => {
            const error = { code, message: code, retryable: false };
            onEvent({ kind: 'failed', error });
            reject(new IpcError(error));
          },
        });
      }),
  };
  return { client, runs };
}

const inPanel = () => within(screen.getByRole('tabpanel'));
const tick = () => inPanel().getByRole('checkbox', { name: 'Add a summary comment' });
const area = () => inPanel().getByRole('textbox');

async function openAndTick(client: IpcClient, runs: Run[]) {
  // Not restored: opened the way Finish review does.
  const { router } = renderApp({ screen: 'S-01' }, client);
  await act(() => router.navigate(`/session/${MR_SESSION}/summary`));
  await within(await screen.findByRole('tabpanel')).findAllByRole('listitem');
  await userEvent.click(tick());
  await waitFor(() => {
    expect(runs).toHaveLength(1);
  });
}

describe('S-05 summary comment states (F-12.4)', () => {
  it('F-12.4 typing after a failed run replaces the failure line and Retry with the reviewer’s words', async () => {
    const { client, runs } = await backend();
    await openAndTick(client, runs);
    act(() => {
      runs[0]?.fail('CLAUDE_FAILED');
    });
    expect(await inPanel().findByText(FAILED)).toBeInTheDocument();
    await userEvent.type(area(), 'Mine.');
    expect(inPanel().queryByText(FAILED)).toBeNull();
    expect(inPanel().queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(inPanel().queryByText(SUGGESTED)).toBeNull();
    expect(area()).toHaveValue('Mine.');
    expect(runs).toHaveLength(1);
  });

  it('F-12.4 emptying Claude’s words drops the "Suggested by Claude" label and the area is named by the checkbox', async () => {
    const { client, runs } = await backend();
    await openAndTick(client, runs);
    act(() => {
      runs[0]?.finish(SUGGESTION);
    });
    await inPanel().findByRole('textbox', { name: SUGGESTED });
    await userEvent.clear(area());
    expect(inPanel().queryByText(SUGGESTED)).toBeNull();
    expect(inPanel().getByRole('textbox', { name: 'Add a summary comment' })).toHaveValue('');
    await waitFor(async () => {
      expect(await client.sessionSummary(MR_SESSION)).toEqual({
        enabled: true,
        text: '',
        suggested: false,
      });
    });
  });

  it('F-12.4 ticking again with an empty area asks Claude again; with words in it, it does not', async () => {
    const { client, runs } = await backend();
    await openAndTick(client, runs);
    act(() => {
      runs[0]?.fail('CLAUDE_SCHEMA');
    });
    expect(await inPanel().findByText(FAILED)).toBeInTheDocument();
    await userEvent.click(tick());
    await userEvent.click(tick());
    await waitFor(() => {
      expect(runs).toHaveLength(2);
    });
    expect(inPanel().queryByText(FAILED)).toBeNull();

    await userEvent.type(area(), 'Mine.');
    act(() => {
      runs[1]?.finish(SUGGESTION);
    });
    await userEvent.click(tick());
    await userEvent.click(tick());
    expect(area()).toHaveValue('Mine.');
    expect(runs).toHaveLength(2);
  });
});
