import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient, type MockOptions } from '../../ipc/mock';
import type { StepView } from '../../ipc/types/StepView';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// F-08.9: the end-of-step card at the end of S-04's main column (Main.dc.html): "End of step 4"
// (the step's number in the reader's order), "Next: <title> · N files · +add −del" with the rail's
// numbers (M4 plan, decision 11) and Next step with its key `]`. On the last step it reads "End of
// step 8", "That was the last step." and Finish review in place of Next step, which opens S-05.

const SESSION = 'mock-mr-session-1';
const DETAILED = pathFor({ screen: 'S-04', sessionId: SESSION });
const SUMMARY = pathFor({ screen: 'S-05', sessionId: SESSION });

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

/** A mock backend of its own, with the plan prepared as S-02 does. */
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

const squash = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

/** The innermost element whose whole text is `text` (the card splits it over <b> and <span>). */
const wholeText = (text: string) => (_: string, element: Element | null) =>
  element !== null &&
  squash(element.textContent) === text &&
  Array.from(element.children).every((child) => squash(child.textContent) !== text);

/** S-04's own main column (the shell's <main> holds the whole screen). */
function mainColumn(): HTMLElement {
  const main = document.querySelector<HTMLElement>('main main');
  if (!main) throw new Error('no S-04 main column');
  return main;
}

/** The card's Next step: the header's comes first in the main column, the card's below it. */
function cardNext(): HTMLElement {
  const buttons = within(mainColumn()).getAllByRole('button', { name: /^Next step/ });
  expect(buttons).toHaveLength(2);
  const card = buttons[1];
  if (!card) throw new Error('no Next step on the end-of-step card');
  return card;
}

describe('S-04 end-of-step card (F-08.9)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-08.9 a middle step ends with "End of step 4", the next step’s title with its files and lines, and Next step with ]', async () => {
    await openDetailed(await backend());
    expect(await screen.findByText(wholeText('End of step 4'))).toBeInTheDocument();
    expect(
      screen.getByText(wholeText('Next: Offline banner in the view · 2 files · +24 −2')),
    ).toBeInTheDocument();
    expect(within(cardNext()).getByText(']')).toBeInTheDocument();
    expect(screen.queryByText(wholeText('That was the last step.'))).toBeNull();
    expect(within(mainColumn()).queryByRole('button', { name: /^Finish review/ })).toBeNull();
  });

  it('F-08.9 the next step’s numbers are the rail’s: one file singular, no −0', async () => {
    const { router } = await openDetailed(await backend(), 's1');
    expect(await screen.findByText(wholeText('End of step 1'))).toBeInTheDocument();
    expect(
      screen.getByText(wholeText('Next: SqliteUploadQueue · 1 file · +142')),
    ).toBeInTheDocument();

    await router.navigate(`${DETAILED}?step=s6`);
    expect(await screen.findByText(wholeText('End of step 6'))).toBeInTheDocument();
    expect(
      screen.getByText(wholeText('Next: Android: network state · 1 file · +1')),
    ).toBeInTheDocument();
  });

  it('F-08.9 Next step on the card opens the next step in Detailed mode, which has its own card', async () => {
    const { router } = await openDetailed(await backend());
    await screen.findByText(wholeText('End of step 4'));
    await userEvent.click(cardNext());
    await waitFor(() => {
      expect(router.state.location.search).toBe('?step=s5');
    });
    expect(router.state.location.pathname).toBe(DETAILED);
    expect(await screen.findByText('Step 5 / 8')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Offline banner in the view',
    );
    expect(await screen.findByText(wholeText('End of step 5'))).toBeInTheDocument();
    expect(
      screen.getByText(wholeText('Next: DI registration and worker start · 2 files · +11')),
    ).toBeInTheDocument();
  });

  it('F-08.9 the step number, the next step and the last step follow the reader’s order', async () => {
    const client = await backend();
    await client.reviewSetStrategy(SESSION, 'testsFirst');
    const { router } = await openDetailed(client, 's8');
    expect(await screen.findByText(wholeText('End of step 1'))).toBeInTheDocument();
    expect(screen.getByText(wholeText('Next: Queue contract · 2 files · +38'))).toBeInTheDocument();
    expect(screen.queryByText(wholeText('That was the last step.'))).toBeNull();

    // Tests first ends with step 7 of the plan (Android), so its card is the last step's.
    await router.navigate(`${DETAILED}?step=s7`);
    expect(await screen.findByText(wholeText('End of step 8'))).toBeInTheDocument();
    expect(screen.getByText(wholeText('That was the last step.'))).toBeInTheDocument();
  });

  it('F-08.9 the last step’s card reads "End of step 8", "That was the last step." and Finish review instead of Next step', async () => {
    await openDetailed(await backend(), 's8');
    expect(await screen.findByText(wholeText('End of step 8'))).toBeInTheDocument();
    expect(screen.getByText(wholeText('That was the last step.'))).toBeInTheDocument();
    expect(screen.queryByText(/^Next: /)).toBeNull();
    // Only the header's Next step is left, disabled on the last step (F-08.4).
    const nexts = within(mainColumn()).getAllByRole('button', { name: /^Next step/ });
    expect(nexts).toHaveLength(1);
    expect(nexts[0]).toBeDisabled();
    // `]` finishes the review on the last step (F-30.3, FinishReview.test.tsx).
    expect(within(mainColumn()).getByRole('button', { name: 'Finish review' })).toBeEnabled();
  });

  it('F-08.9 Finish review on the last step’s card opens the summary, S-05', async () => {
    const { router } = await openDetailed(await backend(), 's8');
    await screen.findByText(wholeText('That was the last step.'));
    await userEvent.click(within(mainColumn()).getByRole('button', { name: 'Finish review' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(SUMMARY);
    });
  });

  it('F-08.9 the card waits for the step’s files and shows once they are read', async () => {
    const client = await backend();
    let release: (() => void) | undefined;
    const reviewStep: IpcClient['reviewStep'] = async (sessionId, stepId) => {
      const view: StepView = await client.reviewStep(sessionId, stepId);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return view;
    };
    await openDetailed({ ...client, reviewStep });
    expect(await screen.findByText('Step 4 / 8')).toBeInTheDocument();
    await waitFor(() => {
      expect(release).toBeDefined();
    });
    // While the diff loads the card would sit right under the header and then jump down.
    expect(screen.queryByText(wholeText('End of step 4'))).toBeNull();
    release?.();
    expect(await screen.findByText(wholeText('End of step 4'))).toBeInTheDocument();
    expect(
      screen.getByText(wholeText('Next: Offline banner in the view · 2 files · +24 −2')),
    ).toBeInTheDocument();
  });

  it('F-08.9 when the step’s files cannot be read the card still offers Next step under the error', async () => {
    const client = await backend();
    const reviewStep: IpcClient['reviewStep'] = () =>
      Promise.reject(
        new IpcError({
          code: 'INTERNAL',
          message: 'The step could not be read.',
          retryable: false,
        }),
      );
    const { router } = await openDetailed({ ...client, reviewStep });
    expect(await within(mainColumn()).findByRole('alert')).toHaveTextContent(
      'The step could not be read.',
    );
    expect(await screen.findByText(wholeText('End of step 4'))).toBeInTheDocument();
    await userEvent.click(cardNext());
    await waitFor(() => {
      expect(router.state.location.search).toBe('?step=s5');
    });
  });
});
