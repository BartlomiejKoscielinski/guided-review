import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import type { FindingDecision } from '../../ipc/types/FindingDecision';
import { useFocusStore } from '../../state/focus';
import { NO_REVIEW, useReviewStore } from '../../state/review';
import { renderApp } from '../../test/renderApp';

// F-30.6 on S-04 (M4 plan, decision 14): the review keys S-03 has, on Detailed mode: `[` the
// previous step, J/K the current hunk with the focus outline on its hunk header, D/X on the
// focused note, Ctrl+Shift+O Rider at the current line.

const SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const HUNK_1 = 'lines 12–31 · DeliveryPhotoViewModel';
const HUNK_2 = 'lines 39–60 · SendPhotoAsync';
const HUNK_3 = 'lines 61–74 · RetryAsync';
const PENDING = 'PendingCount won’t refresh after upload';

interface Calls {
  decide: [string, string, FindingDecision][];
  rider: [string, number, string | undefined][];
}

/** S-04 on !482's step `step`, its plan prepared as S-02 does. */
async function openDetailed(step: string) {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  await ipc.reviewPlan(SESSION, () => undefined);
  const calls: Calls = { decide: [], rider: [] };
  const client: IpcClient = {
    ...ipc,
    reviewDecide: (session, finding, decision) => {
      calls.decide.push([session, finding, decision]);
      return ipc.reviewDecide(session, finding, decision);
    },
    riderOpen: (file, line, session) => {
      calls.rider.push([file, line, session]);
      return Promise.resolve();
    },
  };
  const app = renderApp({ screen: 'S-04', sessionId: SESSION }, client);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId: SESSION })}?step=${step}`);
  await screen.findByRole('heading', { level: 1 });
  expect(await screen.findByText(`Step ${step.slice(1)} / 8`)).toBeInTheDocument();
  return { ...app, calls };
}

const press = (keys: string) => userEvent.keyboard(keys);

/** The hunk J/K made current: the one element marked `aria-current="true"` (its focus outline). */
function currentHunk(): Element | null {
  const marked = document.querySelectorAll('[aria-current="true"]');
  expect(marked.length).toBeLessThanOrEqual(1);
  return marked[0] ?? null;
}

async function expectCurrentHunk(label: string) {
  await waitFor(() => {
    expect(currentHunk()).toHaveTextContent(label);
  });
}

async function expectFocusedNote(title: string) {
  await waitFor(() => {
    const guide = within(screen.getByRole('complementary', { name: 'Guide' }));
    const notes = within(guide.getByRole('region', { name: 'Code notes' }));
    const row = notes.getByRole('button', { name: (name) => name.includes(title) });
    expect(row).toHaveAttribute('aria-pressed', 'true');
  });
}

describe('S-04 review keys (F-30.6)', () => {
  let original: PropertyDescriptor | undefined;

  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    useReviewStore.setState({ key: null, ...NO_REVIEW });
    // jsdom lays nothing out: a measured diff row is one line high and the column is tall, so
    // step 4's lines render, as in GuideKeys.test.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
    original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('F-30.6 [ opens the previous step on S-04; on step 1 it stays', async () => {
    const { router } = await openDetailed('s2');
    await press('{Control>}[[{/Control}');
    expect(screen.getByText('Step 2 / 8')).toBeInTheDocument();
    await press('[[');
    expect(await screen.findByText('Step 1 / 8')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?step=s1');
    await press('[[');
    expect(screen.getByText('Step 1 / 8')).toBeInTheDocument();
  });

  it('F-30.6 J and K move the current hunk with its header outlined, stopping at the ends', async () => {
    await openDetailed('s4');
    expect(await screen.findByText(HUNK_1)).toBeInTheDocument();
    expect(currentHunk()).toBeNull();
    await press('j');
    await expectCurrentHunk(HUNK_1);
    await press('j');
    await expectCurrentHunk(HUNK_2);
    await press('j');
    await expectCurrentHunk(HUNK_3);
    // The last hunk: J stays, no wrap.
    await press('j');
    await expectCurrentHunk(HUNK_3);
    await press('k');
    await expectCurrentHunk(HUNK_2);
    await press('k');
    await expectCurrentHunk(HUNK_1);
    // The first hunk: K stays.
    await press('k');
    await expectCurrentHunk(HUNK_1);
  });

  it('F-30.6 J and K do nothing with Ctrl or Alt held', async () => {
    await openDetailed('s4');
    expect(await screen.findByText(HUNK_1)).toBeInTheDocument();
    await press('{Alt>}j{/Alt}');
    await press('{Control>}j{/Control}');
    expect(currentHunk()).toBeNull();
    await press('j');
    await expectCurrentHunk(HUNK_1);
  });

  it('F-30.6 D on S-04 adds the focused note to drafts; X then does nothing on it', async () => {
    const { calls } = await openDetailed('s4');
    await expectFocusedNote(PENDING);
    await press('d');
    await waitFor(() => {
      expect(calls.decide).toEqual([[SESSION, 'f2', { kind: 'addToDrafts' }]]);
    });
    await press('x');
    expect(calls.decide).toHaveLength(1);
  });

  it('F-30.6 X on S-04 dismisses the focused note', async () => {
    const { calls } = await openDetailed('s4');
    await expectFocusedNote(PENDING);
    await press('x');
    await waitFor(() => {
      expect(calls.decide).toEqual([[SESSION, 'f2', { kind: 'dismiss' }]]);
    });
  });

  it('F-30.6 Ctrl+Shift+O on S-04 opens the file in Rider at the focused note’s line', async () => {
    const { calls } = await openDetailed('s4');
    await expectFocusedNote(PENDING);
    await press('{Control>}{Shift>}O{/Shift}{/Control}');
    await waitFor(() => {
      expect(calls.rider).toEqual([[VM, 49, SESSION]]);
    });
  });
});
