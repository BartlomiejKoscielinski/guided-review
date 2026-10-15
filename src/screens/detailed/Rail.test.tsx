import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient, type MockOptions } from '../../ipc/mock';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// F-08.3: the S-04 rail (Main.dc.html's "Review plan"): a first item "Change overview" (intent,
// risks, plan) that opens S-02 and is done once the plan was opened, the plan steps in the
// reader's order with their state (done = green check, current = yellow, upcoming = number),
// `layer · N files · +add −del` and the per-step draft count, the Skim list, and "Change
// coverage" with its bar and the rule text.

const SESSION = 'mock-mr-session-1';
const DETAILED = pathFor({ screen: 'S-04', sessionId: SESSION });
const PLAN = pathFor({ screen: 'S-02', sessionId: SESSION });
const SQLITE_QUEUE = 'src/Mobile.Infrastructure/Uploads/SqliteUploadQueue.cs';
const WORKER = 'src/Mobile.Infrastructure/Uploads/UploadWorker.cs';

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

/**
 * A mock backend of its own, so a test's marks and drafts stay in that test, with the session's
 * plan prepared as S-02 prepares it (the rail never starts a plan, F-30.4).
 */
async function backend(): Promise<IpcClient> {
  const client = createMockClient({ latencyMs: 0, storage: memoryStorage() });
  await client.reviewPlan(SESSION, () => undefined);
  return client;
}

const rail = () => within(screen.getByRole('navigation', { name: 'Review plan' }));
const row = (name: RegExp) => rail().getByRole('button', { name });
const hasCheck = (element: HTMLElement) => element.querySelector('svg') !== null;
const rowTexts = () =>
  rail()
    .getAllByRole('button')
    .map((b) => b.textContent);

async function openDetailed(client: IpcClient, step = 's4') {
  const app = renderApp({ screen: 'S-04', sessionId: SESSION }, client);
  await app.router.navigate(`${DETAILED}?step=${step}`);
  expect(
    await rail().findByRole('button', { name: /ViewModel: queue instead of upload/ }),
  ).toBeInTheDocument();
  return app;
}

async function markReviewed(client: IpcClient, ...steps: string[]) {
  for (const step of steps) await client.reviewMarkStep(SESSION, step, true);
}

const onLine = (client: IpcClient, file: string, line: number) =>
  client.draftsCreate({
    sessionId: SESSION,
    findingId: null,
    body: `A comment on line ${String(line)}.`,
    position: { file, side: 'new', line },
    severity: null,
  });

describe('S-04 rail (F-08.3)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-08.3 the rail starts with "Change overview", then the steps in the reader’s order', async () => {
    await openDetailed(await backend());
    expect(rail().getByText('Review plan')).toBeInTheDocument();
    expect(rail().getByText('contract → UI')).toBeInTheDocument();
    const names = rowTexts();
    expect(names[0]).toContain('Change overview');
    expect(names[0]).toContain('intent, risks, plan');
    const titles = [
      'Queue contract',
      'SqliteUploadQueue',
      'UploadWorker with retries',
      'ViewModel: queue instead of upload',
      'Offline banner in the view',
      'DI registration and worker start',
      'Android: network state',
      'Queue tests',
    ];
    titles.forEach((title, i) => {
      expect(names[i + 1]).toContain(title);
    });
  });

  it('F-08.3 each step shows its layer, file count and +add −del', async () => {
    await openDetailed(await backend());
    expect(row(/Queue contract/)).toHaveTextContent('Core · 2 files · +38');
    expect(row(/Queue contract/)).not.toHaveTextContent('−');
    expect(row(/ViewModel: queue instead of upload/)).toHaveTextContent('App · 1 file · +18 −9');
    expect(row(/Offline banner in the view/)).toHaveTextContent('XAML · 2 files · +24 −2');
    expect(row(/Android: network state/)).toHaveTextContent('Platforms · 1 file · +1');
  });

  it('F-08.3 done steps show a green check, the current one is marked, upcoming ones their number', async () => {
    const client = await backend();
    await markReviewed(client, 's1', 's2', 's3');
    await openDetailed(client);
    const done: [RegExp, string][] = [
      [/Queue contract/, '1'],
      [/SqliteUploadQueue/, '2'],
      [/UploadWorker with retries/, '3'],
    ];
    for (const [title, n] of done) {
      const item = row(title);
      expect(hasCheck(item)).toBe(true);
      expect(within(item).queryByText(n)).toBeNull();
      expect(item).not.toHaveAttribute('aria-current');
    }
    const current = row(/ViewModel: queue instead of upload/);
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(within(current).getByText('4')).toBeInTheDocument();
    expect(hasCheck(current)).toBe(false);
    const upcoming = row(/Offline banner in the view/);
    expect(within(upcoming).getByText('5')).toBeInTheDocument();
    expect(hasCheck(upcoming)).toBe(false);
    expect(upcoming).not.toHaveAttribute('aria-current');
    expect(within(row(/Queue tests/)).getByText('8')).toBeInTheDocument();
  });

  it('F-08.3 the current step shows a check instead of its number once marked reviewed', async () => {
    const client = await backend();
    await markReviewed(client, 's4');
    await openDetailed(client);
    const current = row(/ViewModel: queue instead of upload/);
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(hasCheck(current)).toBe(true);
    expect(within(current).queryByText('4')).toBeNull();
  });

  it('F-08.3 the current step shows how many of its notes are still open', async () => {
    await openDetailed(await backend());
    expect(
      await within(row(/ViewModel: queue instead of upload/)).findByText('4 notes'),
    ).toBeInTheDocument();
  });

  it('F-08.3 each step shows how many drafts it has', async () => {
    const client = await backend();
    await onLine(client, SQLITE_QUEUE, 3);
    await onLine(client, SQLITE_QUEUE, 4);
    await onLine(client, WORKER, 2);
    await client.draftsCreate({
      sessionId: SESSION,
      findingId: null,
      body: 'Looks good overall.',
      position: null,
      severity: null,
    });
    await openDetailed(client);
    expect(await within(row(/SqliteUploadQueue/)).findByTitle('2 drafts')).toHaveTextContent('2');
    expect(within(row(/UploadWorker with retries/)).getByTitle('1 draft')).toHaveTextContent('1');
    expect(within(row(/Queue contract/)).queryByTitle(/draft/)).toBeNull();
    expect(within(row(/Offline banner in the view/)).queryByTitle(/draft/)).toBeNull();
  });

  it('F-08.3 Change overview is done only once S-02 showed the plan, and opens S-02', async () => {
    const client = await backend();
    const sessionMarkPlanOpened = vi.fn<IpcClient['sessionMarkPlanOpened']>((id) =>
      client.sessionMarkPlanOpened(id),
    );
    const { router } = await openDetailed({ ...client, sessionMarkPlanOpened });
    const overview = () => row(/Change overview/);
    expect(hasCheck(overview())).toBe(false);
    expect(sessionMarkPlanOpened).not.toHaveBeenCalled();

    await userEvent.click(overview());
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(PLAN);
    });
    expect(await screen.findByRole('heading', { name: 'Plan · 8 steps' })).toBeInTheDocument();
    await waitFor(() => {
      expect(sessionMarkPlanOpened).toHaveBeenCalledWith(SESSION);
    });

    await router.navigate(`${DETAILED}?step=s4`);
    await waitFor(() => {
      expect(hasCheck(overview())).toBe(true);
    });
  });

  it('F-08.3 Change overview shows done when the session’s plan was opened before', async () => {
    const client = await backend();
    await client.sessionMarkPlanOpened(SESSION);
    await openDetailed(client);
    await waitFor(() => {
      expect(hasCheck(row(/Change overview/))).toBe(true);
    });
  });

  it('F-08.3 a step in the rail opens that step in Detailed mode', async () => {
    const { router } = await openDetailed(await backend());
    await userEvent.click(row(/Offline banner in the view/));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?step=s5');
    });
    expect(router.state.location.pathname).toBe(DETAILED);
    await waitFor(() => {
      expect(row(/Offline banner in the view/)).toHaveAttribute('aria-current', 'step');
    });
  });

  it('F-08.3 the head names the strategy and the steps follow it', async () => {
    const client = await backend();
    await client.reviewSetStrategy(SESSION, 'testsFirst');
    await openDetailed(client);
    expect(rail().getByText('tests first')).toBeInTheDocument();
    const names = rowTexts();
    expect(names[1]).toContain('Queue tests');
    expect(names[2]).toContain('Queue contract');
  });

  it('F-08.3 Skim lists the skim reasons with the file count', async () => {
    await openDetailed(await backend());
    expect(rail().getByText('Skim')).toBeInTheDocument();
    expect(rail().getByText('5 files')).toBeInTheDocument();
    expect(
      rail().getByText(
        'Formatting (3), csproj with a new package, 3 keys in Strings.resx. Checked: no logic changes.',
      ),
    ).toBeInTheDocument();
  });

  it('F-08.3 Change coverage shows the covered files and the rule text', async () => {
    await openDetailed(await backend());
    expect(rail().getByText('Change coverage')).toBeInTheDocument();
    expect(rail().getByText('16/16 files')).toBeInTheDocument();
    expect(
      rail().getByText('Every hunk belongs to a step. The order can change, the scope can’t.'),
    ).toBeInTheDocument();
  });
});
