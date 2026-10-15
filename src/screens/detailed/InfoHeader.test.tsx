import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient, type MockOptions } from '../../ipc/mock';
import type { Draft } from '../../ipc/types/Draft';
import type { PipelineState } from '../../ipc/types/PipelineState';
import type { SessionMr } from '../../ipc/types/SessionMr';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';
import { changeTotals } from '../plan/sourceText';

// F-08.2: the S-04 info header (Main.dc.html's <header>): the branch block, author · age,
// `N files +add −del`, "Steps" with one segment per step and done/total, "Drafts N" and
// "Pipeline <status>" linking to S-08. The numbers are the S-02 header's (MrMetaLine /
// SourceMetaLine); a self-review shows "To fix N" and no pipeline (M4 decision 12). The colours
// of the segments and the branch block are checked in tests/e2e/detailed.spec.ts.

const SESSION = 'mock-mr-session-1';
const HOUR = 3_600_000;

const SESSION_MR: SessionMr = {
  mr: {
    iid: 482,
    title: 'Offline queue for delivery photos',
    author: 'Marta K.',
    createdAt: new Date(Date.now() - 2 * HOUR - 60_000).toISOString(),
    sourceBranch: 'feature/offline-upload',
    targetBranch: 'develop',
    pipeline: 'passed',
  },
  groups: [],
  totalFiles: 16,
  additions: 462,
  deletions: 61,
  commits: 3,
};

const withPipeline = (pipeline: PipelineState | undefined): SessionMr => ({
  ...SESSION_MR,
  mr: { ...SESSION_MR.mr, pipeline },
});

const draft = (id: string, publishedNoteId: number | null = null): Draft => ({
  id,
  sessionId: SESSION,
  findingId: null,
  body: `Comment ${id}`,
  position: null,
  severity: null,
  include: true,
  publishedNoteId,
  error: null,
});

type MockStorage = NonNullable<MockOptions['storage']>;

function memoryStorage(): MockStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

/** The mock backend after `reviewed` steps of the MR session were marked (the app started again). */
async function markedClient(reviewed: string[]): Promise<IpcClient> {
  const storage = memoryStorage();
  const before = createMockClient({ latencyMs: 0, storage });
  await before.reviewPlan(SESSION, () => undefined);
  for (const id of reviewed) await before.reviewMarkStep(SESSION, id, true);
  return createMockClient({ latencyMs: 0, storage });
}

/** S-04 of the MR session on step 4. */
async function openDetailed(client: Partial<IpcClient>, sessionId = SESSION) {
  const app = renderApp({ screen: 'S-04', sessionId }, client);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId })}?step=s4`);
  await screen.findByTestId('info-header');
  return app;
}

const info = () => screen.getByTestId('info-header');
const squash = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, '');

/** The innermost element of the info header whose whole text is `text` (spacing aside). */
const piece = async (text: string) => {
  const whole = (_content: string, el: Element | null) =>
    el !== null &&
    squash(el.textContent) === squash(text) &&
    Array.from(el.children).every((child) => squash(child.textContent) !== squash(text));
  // Failure messages name the text, not the matcher's source.
  whole.toString = () => `the whole text "${text}"`;
  return within(await screen.findByTestId('info-header')).findByText(whole);
};

describe('S-04 info header (F-08.2)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    // jsdom lays nothing out; give elements a size so a virtualized diff renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-08.2 an MR session: the branch block, author · age and N files +add −del', async () => {
    await openDetailed({ sessionMr: () => Promise.resolve(SESSION_MR) });
    expect(await piece('feature/offline-upload → develop')).toBeInTheDocument();
    expect(await piece('Marta K. · 2 h ago')).toBeInTheDocument();
    expect(await piece('16 files +462 −61')).toBeInTheDocument();
    // The S-02 meta line's "· 3 commits" is not part of the info header (Main.dc.html).
    expect(within(info()).queryByText(/commits?/)).toBeNull();
  });

  it('F-08.2 Steps: one segment per step and done/total of the steps marked reviewed', async () => {
    const client = await markedClient(['s1', 's2', 's3']);
    await openDetailed({ ...client, sessionMr: () => Promise.resolve(SESSION_MR) });
    expect(await piece('Steps 3/8')).toBeInTheDocument();
    const segments = within(info()).getByRole('img', { name: 'Step 4 of 8' });
    expect(segments.querySelectorAll('span')).toHaveLength(8);
  });

  it('F-08.2 Steps counts 0/8 when no step is marked reviewed, whatever step is open', async () => {
    await openDetailed({ sessionMr: () => Promise.resolve(SESSION_MR) });
    expect(await piece('Steps 0/8')).toBeInTheDocument();
  });

  it('F-08.2 Drafts N counts the session’s drafts that are not on GitLab yet', async () => {
    const draftsList = vi.fn<IpcClient['draftsList']>(() =>
      Promise.resolve([draft('d1'), draft('d2', 9001), draft('d3')]),
    );
    await openDetailed({ sessionMr: () => Promise.resolve(SESSION_MR), draftsList });
    expect(await piece('Drafts 2')).toBeInTheDocument();
    expect(draftsList).toHaveBeenCalledWith(SESSION);
    expect(within(info()).queryByText(/To fix/)).toBeNull();
  });

  it('F-08.2 Pipeline <status> links to S-08 of the merge request', async () => {
    const { router } = await openDetailed({ sessionMr: () => Promise.resolve(SESSION_MR) });
    const link = await within(info()).findByRole('link', { name: 'Pipeline passed' });
    await userEvent.click(link);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(pathFor({ screen: 'S-08', iid: 482 }));
    });
  });

  it('F-08.2 the pipeline status is the one GitLab reported at preparation (failed)', async () => {
    await openDetailed({ sessionMr: () => Promise.resolve(withPipeline('failed')) });
    expect(
      await within(info()).findByRole('link', { name: 'Pipeline failed' }),
    ).toBeInTheDocument();
  });

  it('F-08.2 an MR without a pipeline has no Pipeline in the info header', async () => {
    await openDetailed({ sessionMr: () => Promise.resolve(withPipeline(undefined)) });
    expect(await piece('feature/offline-upload → develop')).toBeInTheDocument();
    expect(within(info()).queryByText(/Pipeline/)).toBeNull();
    expect(within(info()).queryByRole('link')).toBeNull();
  });

  it('F-08.2 self-review of a commit: its SHA, author · age, the plan’s totals, To fix N and no pipeline', async () => {
    const ipc = createMockClient({ latencyMs: 0 });
    await ipc.repoPick();
    const { sessionId } = await ipc.sessionOpenCommit({ to: 'a3f9c12' });
    const totals = changeTotals(await ipc.reviewPlan(sessionId, () => undefined));
    for (const body of ['Rename the queue', 'Log the retry']) {
      await ipc.draftsCreate({ sessionId, findingId: null, body, position: null, severity: null });
    }
    await openDetailed(ipc, sessionId);

    expect(await piece('a3f9c12')).toBeInTheDocument();
    expect(await within(info()).findByText(/^Marta K\. · /)).toBeInTheDocument();
    expect(totals.additions).toBeGreaterThan(0);
    expect(
      await piece(
        `${String(totals.files)} files +${String(totals.additions)} −${String(totals.deletions)}`,
      ),
    ).toBeInTheDocument();
    expect(await piece('To fix 2')).toBeInTheDocument();
    expect(within(info()).queryByText(/Drafts/)).toBeNull();
    expect(within(info()).queryByText(/Pipeline/)).toBeNull();
    expect(within(info()).queryByRole('link')).toBeNull();
  });

  it('F-08.2 while the session is looked up neither Drafts nor To fix is shown', async () => {
    await openDetailed({ sessionMr: () => new Promise<SessionMr | null>(() => undefined) });
    expect(await screen.findByTestId('info-header')).toBeInTheDocument();
    // The MR copy is not a fallback: a self-review would show Drafts 0 until the lookup answers.
    expect(within(info()).queryByText(/Drafts/)).toBeNull();
    expect(within(info()).queryByText(/To fix/)).toBeNull();
    expect(within(info()).queryByText(/Pipeline/)).toBeNull();
  });

  it('F-08.2 when the drafts cannot be read, no drafts count is guessed', async () => {
    await openDetailed({
      sessionMr: () => Promise.resolve(SESSION_MR),
      draftsList: () =>
        Promise.reject(
          new IpcError({
            code: 'INTERNAL',
            message: 'The drafts could not be read.',
            retryable: false,
          }),
        ),
    });
    expect(await piece('feature/offline-upload → develop')).toBeInTheDocument();
    expect(
      await within(info()).findByRole('link', { name: 'Pipeline passed' }),
    ).toBeInTheDocument();
    expect(within(info()).queryByText(/Drafts/)).toBeNull();
  });
});
