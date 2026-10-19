import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-14.3: the notes of the Approval tile of S-05 (SummaryDesk.dc.html, approveNote and
// threadsLine), two lines under the Approve MR / Revoke approval button:
//   note:    "Approving doesn’t publish comments."   (typographic apostrophe, as in the mock)
//            or, once the user approved while a draft of the session is still unpublished
//            (`publishedNoteId` null; ticked or not), "Approved without comments. Your drafts are
//            waiting, publish them whenever you like."  (it replaces the first note)
//   threads: "Open threads: N." (N = threads not resolved, the number on the Threads tab) or
//            "All threads resolved." when none is open. !482 has three open threads.
// Decision (tests stage): while the threads are loading or their read failed, the threads line is
// absent (nothing is claimed, as with the approval state in F-14.1); the note stays.
//
// Locators the screen keeps: both lines as separate text elements inside the aside named
// "Approval", the exact copy as one text node each.

const MR_SESSION = 'mock-mr-session-1';
const NOTE = 'Approving doesn’t publish comments.';
const WAITING =
  'Approved without comments. Your drafts are waiting, publish them whenever you like.';

async function backend(override: Partial<IpcClient> = {}, drafts = 0) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  await base.reviewPlan(MR_SESSION, () => undefined);
  for (let i = 0; i < drafts; i += 1) {
    await base.draftsCreate({
      sessionId: MR_SESSION,
      findingId: null,
      body: `Draft ${String(i + 1)}`,
      position: null,
      severity: null,
    });
  }
  return recordingClient({ ...base, ...override });
}

async function show(rec: Awaited<ReturnType<typeof backend>>) {
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(`/session/${MR_SESSION}/summary`));
  await screen.findByRole('tablist', { name: 'Comments' });
  return { ...app, ...rec };
}

async function openSummary(override: Partial<IpcClient> = {}, drafts = 0) {
  return show(await backend(override, drafts));
}

const tile = () => screen.findByRole('complementary', { name: 'Approval' });
async function approve() {
  const button = await within(await tile()).findByRole('button', { name: 'Approve MR' });
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  await userEvent.click(button);
  await within(await tile()).findByText('Approved by you');
}

describe('S-05 Approval tile notes (F-14.3)', () => {
  it('F-14.3 a fresh tile says "Approving doesn’t publish comments." and "Open threads: 3."', async () => {
    await openSummary();

    const aside = await tile();
    expect(await within(aside).findByText(NOTE)).toBeInTheDocument();
    expect(await within(aside).findByText('Open threads: 3.')).toBeInTheDocument();
    expect(within(aside).queryByText('All threads resolved.')).toBeNull();
    expect(within(aside).queryByText(WAITING)).toBeNull();
  });

  it('F-14.3 with every thread resolved the tile says "All threads resolved." and no open count', async () => {
    const rec = await backend();
    for (const t of await rec.client.gitlabDiscussions(MR_SESSION)) {
      await rec.client.gitlabResolve(MR_SESSION, t.id, true);
    }
    await show(rec);

    const aside = await tile();
    expect(await within(aside).findByText('All threads resolved.')).toBeInTheDocument();
    expect(within(aside).queryByText(/^Open threads:/)).toBeNull();
    expect(within(aside).getByText(NOTE)).toBeInTheDocument();
  });

  it('F-14.3 resolving a thread on the Threads tab lowers the tile to "Open threads: 2."', async () => {
    await openSummary();
    const aside = await tile();
    expect(await within(aside).findByText('Open threads: 3.')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('tab', { name: /^Threads/ }));
    const [first] = await screen.findAllByRole('button', { name: 'Resolve' });
    if (!first) throw new Error('no Resolve button');
    await userEvent.click(first);

    expect(await within(aside).findByText('Open threads: 2.')).toBeInTheDocument();
  });

  it('F-14.3 approved with an unpublished draft: "Approved without comments. Your drafts are waiting, publish them whenever you like." replaces the first note', async () => {
    await openSummary({}, 1);
    expect(await within(await tile()).findByText(NOTE)).toBeInTheDocument();

    await approve();

    const aside = await tile();
    expect(await within(aside).findByText(WAITING)).toBeInTheDocument();
    expect(within(aside).queryByText(NOTE)).toBeNull();
    expect(within(aside).getByText('Open threads: 3.')).toBeInTheDocument();
  });

  it('F-14.3 an unticked draft still counts as waiting', async () => {
    const rec = await backend({}, 1);
    const [draft] = await rec.client.draftsList(MR_SESSION);
    if (!draft) throw new Error('no draft');
    await rec.client.draftsUpdate(draft.id, { body: null, include: false });
    await show(rec);

    await approve();

    expect(await within(await tile()).findByText(WAITING)).toBeInTheDocument();
  });

  it('F-14.3 approved with no drafts keeps "Approving doesn’t publish comments."', async () => {
    await openSummary();

    await approve();

    const aside = await tile();
    expect(within(aside).getByText(NOTE)).toBeInTheDocument();
    expect(within(aside).queryByText(WAITING)).toBeNull();
  });

  it('F-14.3 not approved, with drafts waiting: still "Approving doesn’t publish comments."', async () => {
    await openSummary({}, 2);

    const aside = await tile();
    expect(await within(aside).findByText('Open threads: 3.')).toBeInTheDocument();
    expect(within(aside).getByText(NOTE)).toBeInTheDocument();
    expect(within(aside).queryByText(WAITING)).toBeNull();
  });

  it('F-14.3 approved, drafts already published: back to "Approving doesn’t publish comments."', async () => {
    const rec = await backend({}, 1);
    const drafts = await rec.client.draftsList(MR_SESSION);
    await show({
      ...rec,
      client: {
        ...rec.client,
        draftsList: () => Promise.resolve(drafts.map((d) => ({ ...d, publishedNoteId: 77 }))),
      },
    });

    await approve();

    const aside = await tile();
    expect(within(aside).getByText(NOTE)).toBeInTheDocument();
    expect(within(aside).queryByText(WAITING)).toBeNull();
  });

  it('F-14.3 Revoke approval takes the waiting note back to "Approving doesn’t publish comments."', async () => {
    await openSummary({}, 1);
    await approve();
    expect(await within(await tile()).findByText(WAITING)).toBeInTheDocument();

    await userEvent.click(
      await within(await tile()).findByRole('button', { name: 'Revoke approval' }),
    );

    const aside = await tile();
    expect(await within(aside).findByText(NOTE)).toBeInTheDocument();
    expect(within(aside).queryByText(WAITING)).toBeNull();
  });

  it('F-14.3 when the threads can’t be read the threads line is absent, the note stays', async () => {
    await openSummary({
      gitlabDiscussions: () =>
        Promise.reject(
          new IpcError({
            code: 'GITLAB_UNREACHABLE',
            message: 'GitLab is unreachable.',
            retryable: true,
          }),
        ),
    });

    const aside = await tile();
    expect(await within(aside).findByText(NOTE)).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(within(aside).queryByText(/^Open threads:/)).toBeNull();
    expect(within(aside).queryByText('All threads resolved.')).toBeNull();
  });
});
