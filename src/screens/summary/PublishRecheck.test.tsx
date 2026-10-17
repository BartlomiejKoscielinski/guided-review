import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import { renderApp } from '../../test/renderApp';

// F-12.5, M5 decision 8 ("checked when S-05 opens and right before publishing"): a Publish whose
// check finds more drafts in GitLab's own review than the yellow banner showed sends nothing and
// shows the new count; the next click publishes. And the summary comment goes out once per run of
// the app, also after leaving S-05 and coming back.

const MR_SESSION = 'mock-mr-session-1';
const SINGLE = 'The author got a single notification.';
const SUMMARY = 'Looks good overall, two things before merging.';

async function backend(): Promise<IpcClient> {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  await base.reviewPlan(MR_SESSION, () => undefined);
  for (const line of [54, 49]) {
    await base.draftsCreate({
      sessionId: MR_SESSION,
      findingId: null,
      severity: 'q',
      body: `Comment on line ${String(line)}.`,
      position: { file: 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs', side: 'new', line },
    });
  }
  return { ...base };
}

async function openSummary(client: IpcClient) {
  const app = renderApp({ screen: 'S-01' }, client);
  await act(() => app.router.navigate(`/session/${MR_SESSION}/summary`));
  await within(await screen.findByRole('tabpanel')).findAllByRole('listitem');
  return app;
}

describe('S-05 Publish checks GitLab first (F-12.5, M5 decision 8)', () => {
  it('F-12.5 drafts that appeared in GitLab since the summary opened stop the Publish and show the banner; the next click publishes', async () => {
    const base = await backend();
    const counts = [0, 2, 2];
    const sent: string[][] = [];
    const client: IpcClient = {
      ...base,
      gitlabForeignDrafts: () => Promise.resolve(counts.shift() ?? 0),
      draftsPublish: (session, ids, summary) => {
        sent.push(ids);
        return base.draftsPublish(session, ids, summary);
      },
    };
    await openSummary(client);
    expect(screen.queryByText(/in GitLab's own review/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Publish (2)' }));

    expect(
      await screen.findByText(
        "You have 2 draft comments in GitLab's own review. Publishing here sends them too.",
      ),
    ).toBeInTheDocument();
    expect(sent).toEqual([]);
    expect(screen.queryByText(/The author got a single notification/)).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Publish (2)' })).toBeEnabled();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Publish (2)' }));

    await screen.findByText(`Published 2 comments. ${SINGLE}`);
    expect(sent).toHaveLength(1);
  });
});

describe('S-05 the summary comment goes out once (F-12.5)', () => {
  it('F-12.5 after leaving S-05 and coming back, a later Publish does not send the summary again', async () => {
    const base = await backend();
    await base.sessionSetSummary(MR_SESSION, { enabled: true, text: SUMMARY, suggested: false });
    const summaries: (string | null)[] = [];
    const client: IpcClient = {
      ...base,
      draftsPublish: (session, ids, summary) => {
        summaries.push(summary);
        return base.draftsPublish(session, ids, summary);
      },
    };
    const app = await openSummary(client);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Publish comment 2' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Publish (1)' })).toBeEnabled();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Publish (1)' }));
    await screen.findByText(`Published 1 comment and a summary. ${SINGLE}`);

    await act(() => app.router.navigate('/'));
    await act(() => app.router.navigate(`/session/${MR_SESSION}/summary`));
    await within(await screen.findByRole('tabpanel')).findAllByRole('listitem');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Publish comment 2' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Publish (1)' })).toBeEnabled();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Publish (1)' }));

    await screen.findByText(`Published 1 comment. ${SINGLE}`);
    expect(summaries).toEqual([SUMMARY, null]);
  });
});
