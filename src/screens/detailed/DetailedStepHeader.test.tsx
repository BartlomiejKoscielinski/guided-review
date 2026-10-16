import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient, type MockOptions } from '../../ipc/mock';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// F-08.4: the S-04 step header (Main.dc.html): "Step 4 / 8" in the reader's order, "builds on"
// chips `<number in current order> · <short title>` from `Step.buildsOn` that open that step,
// Previous step, Mark reviewed and Next step (neither draws a key since F-07.10: Space marks only
// the current file, decision 15), with the H1 title and the description below.

const SESSION = 'mock-mr-session-1';
const DETAILED = pathFor({ screen: 'S-04', sessionId: SESSION });

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

/** A mock backend of its own (marks stay in the test), with the plan prepared as S-02 does. */
async function backend(): Promise<IpcClient> {
  const client = createMockClient({ latencyMs: 0, storage: memoryStorage() });
  await client.reviewPlan(SESSION, () => undefined);
  return client;
}

async function openDetailed(client: Partial<IpcClient>, step = 's4') {
  const app = renderApp({ screen: 'S-04', sessionId: SESSION }, client);
  await app.router.navigate(`${DETAILED}?step=${step}`);
  await screen.findByRole('heading', { level: 1 });
  return app;
}

type Router = Awaited<ReturnType<typeof openDetailed>>['router'];

async function expectStep(router: Router, step: string, kicker: string, title: string) {
  await waitFor(() => {
    expect(router.state.location.search).toBe(`?step=${step}`);
  });
  expect(router.state.location.pathname).toBe(DETAILED);
  expect(await screen.findByText(kicker)).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(title);
}

const previous = () => screen.getByRole('button', { name: 'Previous step' });
// The header's Next step comes first; the end-of-step card (F-08.9) has one of its own below.
const next = () => {
  const [first] = screen.getAllByRole('button', { name: /^Next step/ });
  if (!first) throw new Error('no Next step button');
  return first;
};
const markButton = () => screen.getByRole('button', { name: /^(Mark reviewed|Reviewed)/ });
const railRow = (name: RegExp) =>
  within(screen.getByRole('navigation', { name: 'Review plan' })).getByRole('button', { name });

describe('S-04 step header (F-08.4)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-08.4 the header reads "Step 4 / 8" above the step title and description', async () => {
    await openDetailed(await backend());
    expect(await screen.findByText('Step 4 / 8')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'ViewModel: queue instead of upload',
    );
    expect(
      screen.getByText(
        'Instead of uploading right away, it stores the photo and wakes the worker from step 3.',
      ),
    ).toBeInTheDocument();
  });

  it('F-08.4 "builds on" chips name each earlier step by its number and short title', async () => {
    await openDetailed(await backend());
    expect(await screen.findByText('builds on')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 · Queue contract' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3 · UploadWorker' })).toBeInTheDocument();
  });

  it('F-08.4 the step number and the chip numbers follow the reader’s order', async () => {
    const client = await backend();
    await client.reviewSetStrategy(SESSION, 'testsFirst');
    await openDetailed(client);
    expect(await screen.findByText('Step 5 / 8')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2 · Queue contract' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4 · UploadWorker' })).toBeInTheDocument();
  });

  it('F-08.4 a builds-on chip opens that step in Detailed mode', async () => {
    const { router } = await openDetailed(await backend());
    await userEvent.click(await screen.findByRole('button', { name: '3 · UploadWorker' }));
    await expectStep(router, 's3', 'Step 3 / 8', 'UploadWorker with retries');
    // Step 3's own chips: the steps it builds on.
    expect(await screen.findByRole('button', { name: '1 · Queue contract' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2 · SqliteUploadQueue' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '3 · UploadWorker' })).toBeNull();
  });

  it('F-08.4 a step that builds on nothing shows no "builds on"', async () => {
    await openDetailed(await backend(), 's1');
    expect(await screen.findByText('Step 1 / 8')).toBeInTheDocument();
    expect(screen.queryByText('builds on')).toBeNull();
  });

  it('F-08.4 Previous step opens the step before in the reader’s order', async () => {
    const { router } = await openDetailed(await backend());
    await screen.findByText('Step 4 / 8');
    await userEvent.click(previous());
    await expectStep(router, 's3', 'Step 3 / 8', 'UploadWorker with retries');
  });

  it('F-08.4 Next step opens the next step in the reader’s order (no ] hint since F-07.10)', async () => {
    const { router } = await openDetailed(await backend());
    await screen.findByText('Step 4 / 8');
    expect(next()).toHaveAccessibleName('Next step');
    await userEvent.click(next());
    await expectStep(router, 's5', 'Step 5 / 8', 'Offline banner in the view');
  });

  it('F-08.4 ] opens the next step; with Ctrl held it does nothing', async () => {
    const { router } = await openDetailed(await backend());
    await screen.findByText('Step 4 / 8');
    await userEvent.keyboard(']');
    await expectStep(router, 's5', 'Step 5 / 8', 'Offline banner in the view');
    await userEvent.keyboard('{Control>}]{/Control}');
    await userEvent.keyboard('{Alt>}]{/Alt}');
    expect(router.state.location.search).toBe('?step=s5');
    expect(screen.getByText('Step 5 / 8')).toBeInTheDocument();
  });

  it('F-08.4 Previous step is disabled on the first step of the reader’s order', async () => {
    await openDetailed(await backend(), 's1');
    await screen.findByText('Step 1 / 8');
    expect(previous()).toBeDisabled();
    expect(next()).toBeEnabled();
  });

  it('F-08.4 Mark reviewed marks the step and takes it back, and shows no Space hint', async () => {
    const client = await backend();
    const markStep = vi.fn<IpcClient['reviewMarkStep']>((session, step, reviewed) =>
      client.reviewMarkStep(session, step, reviewed),
    );
    await openDetailed({ ...client, reviewMarkStep: markStep });
    await screen.findByText('Step 4 / 8');
    const button = markButton();
    expect(button).toHaveTextContent(/^Mark reviewed/);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button.querySelector('kbd')).toBeNull();

    await userEvent.click(button);
    await waitFor(() => {
      expect(markButton()).toHaveAttribute('aria-pressed', 'true');
    });
    expect(markButton()).toHaveTextContent(/^Reviewed/);
    expect(markStep).toHaveBeenLastCalledWith(SESSION, 's4', true);
    // The rail shows the step done as well.
    await waitFor(() => {
      expect(railRow(/ViewModel: queue instead of upload/).querySelector('svg')).not.toBeNull();
    });

    await userEvent.click(markButton());
    await waitFor(() => {
      expect(markButton()).toHaveAttribute('aria-pressed', 'false');
    });
    expect(markButton()).toHaveTextContent(/^Mark reviewed/);
    expect(markStep).toHaveBeenLastCalledWith(SESSION, 's4', false);
    expect(markStep).toHaveBeenCalledTimes(2);
  });

  it('F-08.4 Space marks the one file of the step, so the step is reviewed, and takes it back', async () => {
    const client = await backend();
    const markStep = vi.fn<IpcClient['reviewMarkStep']>((session, step, reviewed) =>
      client.reviewMarkStep(session, step, reviewed),
    );
    const markFile = vi.fn<IpcClient['reviewMarkFile']>((session, step, file, reviewed) =>
      client.reviewMarkFile(session, step, file, reviewed),
    );
    await openDetailed({ ...client, reviewMarkStep: markStep, reviewMarkFile: markFile });
    await screen.findByText('Step 4 / 8');
    await userEvent.keyboard(' ');
    await waitFor(() => {
      expect(markButton()).toHaveAttribute('aria-pressed', 'true');
    });
    expect(markButton()).toHaveTextContent(/^Reviewed/);
    await userEvent.keyboard(' ');
    await waitFor(() => {
      expect(markButton()).toHaveAttribute('aria-pressed', 'false');
    });
    // Space is the current file's since F-07.10; step 4 has one file.
    expect(markFile.mock.calls.map((call) => call[3])).toEqual([true, false]);
    expect(markStep).not.toHaveBeenCalled();
  });
});
