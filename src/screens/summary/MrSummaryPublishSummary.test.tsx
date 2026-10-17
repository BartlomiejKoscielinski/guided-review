import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import type { DiffPosition } from '../../ipc/types/DiffPosition';
import type { PublishOutcome } from '../../ipc/types/PublishOutcome';
import { renderApp } from '../../test/renderApp';

// F-12.5 and the summary comment on S-05 (M5 decisions 7 and 9): with only the summary ticked and
// filled the button reads "Publish summary" and sends it alone ("Published a summary. …"); a
// summary GitLab didn't take is named in the orange banner with Retry; a published summary is
// never sent again, also after the app restarts (the core keeps it, not the screen).

const MR_SESSION = 'mock-mr-session-1';
const SINGLE = 'The author got a single notification.';
const SUMMARY = 'Looks good overall, two things before merging.';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const at = (line: number): DiffPosition => ({ file: VM, side: 'new', line });

type PublishArgs = [string, string[], string | null];

async function backend(drafts: number): Promise<IpcClient> {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  await base.reviewPlan(MR_SESSION, () => undefined);
  for (let i = 0; i < drafts; i++) {
    await base.draftsCreate({
      sessionId: MR_SESSION,
      findingId: null,
      severity: 'q',
      body: `Comment ${String(i + 1)}`,
      position: at(40 + i),
    });
  }
  await base.sessionSetSummary(MR_SESSION, { enabled: true, text: SUMMARY, suggested: false });
  return { ...base };
}

/** `base` whose draftsPublish records its arguments; `answers` replace the real answers in turn. */
function watched(base: IpcClient, answers: PublishOutcome[] = []) {
  const calls: PublishArgs[] = [];
  const client: IpcClient = {
    ...base,
    draftsPublish: (session, ids, summary) => {
      calls.push([session, ids, summary]);
      const answer = answers.shift();
      return answer ? Promise.resolve(answer) : base.draftsPublish(session, ids, summary);
    },
  };
  return { client, calls };
}

/** S-05 on its Drafts tab (with nothing left to publish it opens on Threads, decision 5). */
async function openSummary(client: IpcClient) {
  const app = renderApp({ screen: 'S-01' }, client);
  await act(() => app.router.navigate(`/session/${MR_SESSION}/summary`));
  const drafts = await screen.findByRole('tab', { name: /^Drafts/ });
  if (drafts.getAttribute('aria-selected') !== 'true') await userEvent.click(drafts);
  await within(await screen.findByRole('tabpanel')).findAllByRole('listitem');
  return app;
}

const button = (name: string) => screen.getByRole('button', { name });
const box = (n: number) => screen.getByRole('checkbox', { name: `Publish comment ${String(n)}` });

describe('S-05 Publish summary (F-12.5, M5 decision 7)', () => {
  it('F-12.5 with only the summary ticked and filled the button reads Publish summary and sends it alone', async () => {
    const { client, calls } = watched(await backend(2));
    await openSummary(client);
    for (const n of [1, 2]) {
      await userEvent.click(box(n));
      await waitFor(() => {
        expect(box(n)).not.toBeChecked();
      });
    }

    expect(button('Publish summary')).toBeEnabled();
    await userEvent.click(button('Publish summary'));

    await screen.findByText(`Published a summary. ${SINGLE}`);
    expect(calls).toEqual([[MR_SESSION, [], SUMMARY]]);
    await waitFor(() => {
      expect(button('Published')).toBeDisabled();
    });
  });
});

describe('S-05 a summary comment that failed (F-12.5, M5 decision 9)', () => {
  it('F-12.5 the orange banner names it with Retry, and Retry sends only the summary', async () => {
    const mock = await backend(2);
    const ids = (await mock.draftsList(MR_SESSION)).map((d) => d.id);
    const failed = 'Published 2 comments. The summary failed: GitLab is unreachable.';
    const { client, calls } = watched(mock, [
      { published: ids, summary: false, failed: [], summaryFailed: 'GitLab is unreachable' },
    ]);
    await openSummary(client);
    await userEvent.click(button('Publish (2)'));

    const banner = (await screen.findByText(failed)).closest('[role="status"]');
    if (!(banner instanceof HTMLElement)) throw new Error('The failure is not in a status banner.');
    const retry = within(banner).getByRole('button', { name: 'Retry' });
    expect(retry).toBeEnabled();
    expect(screen.queryByText(SINGLE, { exact: false })).toBeNull();

    await userEvent.click(retry);

    await screen.findByText(`Published a summary. ${SINGLE}`);
    expect(calls[1]).toEqual([MR_SESSION, [], SUMMARY]);
  });
});

describe('S-05 a published summary (F-12.5)', () => {
  it('F-12.5 is not sent again after a restart, and the button does not offer it', async () => {
    const mock = await backend(1);
    const { client, calls } = watched(mock);
    const first = await openSummary(client);
    await userEvent.click(button('Publish (1)'));
    await screen.findByText(`Published 1 comment and a summary. ${SINGLE}`);
    first.unmount();

    // The app starts again (a new query cache); the summary is still ticked with its text.
    const second = await openSummary(client);
    await waitFor(() => {
      expect(button('Published')).toBeDisabled();
    });
    expect(screen.queryByRole('button', { name: 'Publish summary' })).toBeNull();

    // A new draft goes out alone.
    await mock.draftsCreate({
      sessionId: MR_SESSION,
      findingId: null,
      severity: 'q',
      body: 'One more thing.',
      position: at(60),
    });
    second.unmount();
    await openSummary(client);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish (1)' }));
    await screen.findByText(`Published 1 comment. ${SINGLE}`);
    expect(calls.map(([, , summary]) => summary)).toEqual([SUMMARY, null]);
  });
});
