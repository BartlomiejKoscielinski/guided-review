import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import type { Draft } from '../../ipc/types/Draft';
import type { JobExplainEvent } from '../../ipc/types/JobExplainEvent';
import type { JobExplanation } from '../../ipc/types/JobExplanation';
import type { JobRow } from '../../ipc/types/JobRow';
import type { UnfinishedSession } from '../../ipc/types/UnfinishedSession';
import { renderApp } from '../../test/renderApp';

// F-20.7 states beyond ExplainFailure.test.tsx (M6 decisions 12 and 14): "Preparing the code…"
// before "Reading the log and the diff…"; a refused Add to drafts says so and keeps the button;
// a file:line chip opens the MR's latest review session when one exists.

const IID = 482;
const ROW: JobRow = {
  id: 5,
  name: 'unit-tests',
  state: 'failed',
  action: 'retry',
  durationSecs: 1,
  webUrl: null,
};
const ANSWER: JobExplanation = {
  verdict: 'causedByMr',
  title: 'Queue order',
  explanation: 'Sorted by Id.',
  evidence: ['SqliteUploadQueue.cs:88'],
  retryRecommended: false,
  suggestedComment: 'Please sort by CreatedAt.',
};
const SESSION = {
  id: 'mr-session-7',
  resume: { screen: 'S-03', sessionId: 'mr-session-7' },
  source: { kind: 'mr', project: 'mobile/mobile-app', iid: IID },
} as UnfinishedSession;

async function open(over: Partial<IpcClient>) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const client: IpcClient = {
    ...base,
    pipelineJobs: () => Promise.resolve([{ name: 'test', jobs: [ROW] }]),
    claudeStatus: () => Promise.resolve({ state: 'signedIn' }),
    ...over,
  };
  const app = renderApp({ screen: 'S-01' }, client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-08', iid: IID })));
  const panel = within(await screen.findByRole('region', { name: 'Job details' }));
  return { app, panel, user: userEvent.setup() };
}

describe('S-08 Explain failure states (F-20.7)', () => {
  it('F-20.7 the panel says Preparing the code… while the worktree is prepared, then Reading the log and the diff…', async () => {
    let send: ((event: JobExplainEvent) => void) | null = null;
    const { panel, user } = await open({
      jobExplain: (_p, _i, _j, onEvent) => {
        send = onEvent;
        return new Promise<JobExplanation>(() => undefined);
      },
    });
    await user.click(await panel.findByRole('button', { name: 'Explain failure' }));
    act(() => {
      send?.({ kind: 'preparing' });
    });
    expect(await panel.findByText('Preparing the code…')).toBeInTheDocument();
    act(() => {
      send?.({ kind: 'reading' });
    });
    expect(await panel.findByText('Reading the log and the diff…')).toBeInTheDocument();
  });

  it("F-20.7 a refused Add to drafts says Couldn't add it to the drafts. with the reason and keeps the button", async () => {
    const { panel, user } = await open({
      jobExplain: () => Promise.resolve(ANSWER),
      draftsCreateForMr: () =>
        Promise.reject(
          new IpcError({
            code: 'GITLAB_UNREACHABLE',
            message: 'GitLab is not answering.',
            retryable: true,
          }),
        ),
    });
    await user.click(await panel.findByRole('button', { name: 'Explain failure' }));
    await user.click(await panel.findByRole('button', { name: 'Add to drafts' }));
    expect(
      await panel.findByText("Couldn't add it to the drafts. GitLab is not answering."),
    ).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'Add to drafts' })).toBeEnabled();
    expect(panel.queryByText('In drafts. Publish it with the rest from Summary.')).toBeNull();
  });

  it("F-20.7 a failed run says Couldn't explain this failure. with the reason, and Retry names why it is disabled", async () => {
    let signedIn = true;
    const { panel, user } = await open({
      claudeStatus: () => Promise.resolve({ state: signedIn ? 'signedIn' : 'notSignedIn' }),
      jobExplain: () => {
        signedIn = false;
        return Promise.reject(
          new IpcError({
            code: 'CLAUDE_SCHEMA',
            message: "Claude's answer didn't fit the expected format.",
            retryable: true,
          }),
        );
      },
    });
    await user.click(await panel.findByRole('button', { name: 'Explain failure' }));
    expect(await panel.findByRole('alert')).toHaveTextContent(
      /^Couldn't explain this failure\. Claude's answer didn't fit the expected format\.$/,
    );
    const retry = panel.getByRole('button', { name: 'Retry' });
    await vi.waitFor(() => {
      expect(retry).toBeDisabled();
    });
    expect(retry).toHaveAttribute('title', "Claude isn't available");
  });

  it('F-20.7 Add to drafts puts the suggested comment unchanged into the drafts S-05 lists', async () => {
    let created: Draft | null = null;
    const mock = createMockClient({ latencyMs: 0 });
    const { app, panel, user } = await open({
      jobExplain: () => Promise.resolve(ANSWER),
      draftsCreateForMr: async (project, iid, draft) => {
        created = await mock.draftsCreateForMr(project, iid, draft);
        return created;
      },
      draftsList: (sessionId) => mock.draftsList(sessionId),
    });
    await user.click(await panel.findByRole('button', { name: 'Explain failure' }));
    await user.click(await panel.findByRole('button', { name: 'Add to drafts' }));
    await panel.findByText('In drafts. Publish it with the rest from Summary.');
    const draft = created as Draft | null;
    expect(draft?.body).toBe('Please sort by CreatedAt.');
    if (!draft) return;
    const listed = await mock.draftsList(draft.sessionId);
    expect(listed.map((d) => d.body)).toContain('Please sort by CreatedAt.');
    await act(() => app.router.navigate(pathFor({ screen: 'S-05', sessionId: draft.sessionId })));
    expect(await screen.findByText('Please sort by CreatedAt.')).toBeInTheDocument();
  });

  it('F-20.7 with a review session of the MR a file:line chip opens it', async () => {
    const { app, panel, user } = await open({
      jobExplain: () => Promise.resolve(ANSWER),
      sessionsListUnfinished: () => Promise.resolve([SESSION]),
    });
    await user.click(await panel.findByRole('button', { name: 'Explain failure' }));
    const chip = await panel.findByRole('button', { name: 'SqliteUploadQueue.cs:88' });
    expect(chip).toHaveAttribute('title', 'Open in the review session');
    await user.click(chip);
    expect(app.router.state.location.pathname).toBe(pathFor(SESSION.resume));
  });
});
