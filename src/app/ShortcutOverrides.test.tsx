import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../ipc/client';
import type { FindingDecision } from '../ipc/types/FindingDecision';
import type { SessionMr } from '../ipc/types/SessionMr';
import { useFocusStore } from '../state/focus';
import { NO_REVIEW, useReviewStore } from '../state/review';
import { renderApp } from '../test/renderApp';
import { clientWithShortcuts, type ChangedShortcuts } from '../test/shortcutSettings';
import { pathFor } from './routes';

// F-19.7: changed shortcuts apply everywhere at once (M4 decision 16): the new keys work, the old
// ones do nothing. `src/app/shortcuts.ts` merges `ui.shortcuts` over the defaults and every
// consumer reads from it: the review keys on S-03 and S-04, and the app-wide chords. The footer and
// button hints are in ShortcutHints.test.tsx; the Settings rows in ShortcutsChange.test.tsx.

const SESSION = 'mock-mr-session-1';
const PENDING = 'PendingCount won’t refresh after upload';
const STATUS = 'Status texts are hardcoded';
const SOURCE = /Paste a merge request link/;

/** !482 as S-02 shows it (the session `s1` of plan/PlanPrepared.test). */
const PLAN_SESSION: SessionMr = {
  mr: {
    iid: 482,
    title: 'Offline queue for delivery photos',
    author: 'Marta K.',
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

/** A backend with `changed` saved and the repository picked, as the S-03 and S-04 tests have it. */
async function backend(changed: ChangedShortcuts = {}): Promise<IpcClient> {
  const client = clientWithShortcuts(changed);
  await client.repoPick();
  return client;
}

const press = (keys: string) => userEvent.keyboard(keys);

/** Layout A's gutter square of a note; the focused note's is pressed. */
const mark = (title: string) =>
  screen.getByRole('button', { name: (name) => name.startsWith('Note') && name.endsWith(title) });

async function expectFocusedNote(title: string) {
  await waitFor(() => {
    expect(mark(title)).toHaveAttribute('aria-pressed', 'true');
  });
}

async function openStep(client: IpcClient, step = 's4') {
  const app = renderApp({ screen: 'S-03', sessionId: SESSION }, client);
  await app.router.navigate(`/session/${SESSION}/step?step=${step}`);
  expect(await screen.findByText(`Step ${step.slice(1)} of 8`)).toBeInTheDocument();
  return app;
}

async function openDetailed(client: IpcClient) {
  const app = renderApp({ screen: 'S-04', sessionId: SESSION }, client);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId: SESSION })}?step=s4`);
  await screen.findByRole('heading', { level: 1 });
  expect(await screen.findByText('Step 4 / 8')).toBeInTheDocument();
  return app;
}

const modeRadio = (name: 'Focus' | 'Detailed') =>
  within(within(screen.getByRole('banner')).getByRole('radiogroup', { name: 'Mode' })).getByRole(
    'radio',
    { name },
  );

describe('changed shortcuts apply everywhere (F-19.7)', () => {
  let original: PropertyDescriptor | undefined;

  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    useReviewStore.setState({ key: null, ...NO_REVIEW });
    // jsdom lays nothing out: a measured diff row is one line high and the column is tall, so the
    // step's lines render, as in step/ReviewKeys.test.
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

  it('F-19.7 a key changed in Settings › Shortcuts works on S-03 at once and the old key does nothing', async () => {
    const client = await backend();
    const app = renderApp({ screen: 'S-07', section: 'shortcuts' }, client);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Change shortcut for Next note' }),
    );
    await press('m');
    expect(screen.queryByText('Press the new keys…')).toBeNull();

    await app.router.navigate(`/session/${SESSION}/step?step=s4`);
    expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
    // The step opens on its first Should fix; N was the key of Next note and now does nothing.
    await expectFocusedNote(PENDING);
    await press('n');
    await expectFocusedNote(PENDING);
    await press('m');
    await expectFocusedNote(STATUS);
  });

  it('F-19.7 a chord can be the key of a review action: Ctrl+Shift+M moves to the next note, M and N do not', async () => {
    await openStep(await backend({ nextNote: ['Ctrl', 'Shift', 'M'] }));
    await expectFocusedNote(PENDING);
    await press('m');
    await press('n');
    await expectFocusedNote(PENDING);
    await press('{Control>}{Shift>}M{/Shift}{/Control}');
    await expectFocusedNote(STATUS);
  });

  it('F-19.7 a changed key works on S-04 too: B adds the focused note to drafts, D does not', async () => {
    const client = await backend({ addToDrafts: ['B'] });
    const decide: [string, string, FindingDecision][] = [];
    const reviewDecide = vi.fn<IpcClient['reviewDecide']>((session, finding, decision) => {
      decide.push([session, finding, decision]);
      return client.reviewDecide(session, finding, decision);
    });
    await openDetailed({ ...client, reviewDecide });
    await waitFor(() => {
      const guide = within(screen.getByRole('complementary', { name: 'Guide' }));
      const notes = within(guide.getByRole('region', { name: 'Code notes' }));
      const row = notes.getByRole('button', { name: (name) => name.includes(PENDING) });
      expect(row).toHaveAttribute('aria-pressed', 'true');
    });
    await press('d');
    expect(decide).toEqual([]);
    await press('b');
    await waitFor(() => {
      expect(decide).toEqual([[SESSION, 'f2', { kind: 'addToDrafts' }]]);
    });
  });

  it('F-19.7 Open anything follows its changed keys: Ctrl+J opens the source field, Ctrl+K does not', async () => {
    renderApp(
      { screen: 'S-07', section: 'general' },
      await backend({ openAnything: ['Ctrl', 'J'] }),
    );
    expect(await screen.findByRole('heading', { name: 'General', level: 1 })).toBeInTheDocument();
    await press('{Control>}k{/Control}');
    expect(screen.queryByLabelText(SOURCE)).toBeNull();
    await press('{Control>}j{/Control}');
    expect(await screen.findByLabelText(SOURCE)).toBeInTheDocument();
  });

  it('F-19.7 Settings follows its changed keys: Ctrl+. opens Settings, Ctrl+, does not', async () => {
    renderApp({ screen: 'S-01' }, await backend({ settings: ['Ctrl', '.'] }));
    await screen.findByLabelText(SOURCE);
    await userEvent.click(document.body);
    await press('{Control>},{/Control}');
    expect(screen.queryByRole('heading', { name: 'General', level: 1 })).toBeNull();
    await press('{Control>}.{/Control}');
    expect(await screen.findByRole('heading', { name: 'General', level: 1 })).toBeInTheDocument();
  });

  it('F-19.7 All shortcuts follows its changed key: H opens Settings › Shortcuts, ? does not', async () => {
    renderApp({ screen: 'S-01' }, await backend({ allShortcuts: ['H'] }));
    await screen.findByLabelText(SOURCE);
    await userEvent.click(document.body);
    await press('{Shift>}?{/Shift}');
    expect(screen.queryByRole('heading', { name: 'Shortcuts', level: 1 })).toBeNull();
    await press('h');
    expect(await screen.findByRole('heading', { name: 'Shortcuts', level: 1 })).toBeInTheDocument();
  });

  it('F-19.7 Switch Focus / Detailed follows its changed keys: Ctrl+E switches on S-03, Ctrl+D does not', async () => {
    await openStep(await backend({ mode: ['Ctrl', 'E'] }));
    expect(modeRadio('Focus')).toBeChecked();
    await press('{Control>}d{/Control}');
    expect(modeRadio('Focus')).toBeChecked();
    await press('{Control>}e{/Control}');
    await waitFor(() => {
      expect(modeRadio('Detailed')).toBeChecked();
    });
  });

  it('F-19.7 the layout keys follow their changed keys: Ctrl+5 opens the Minimal layout, Ctrl+2 does not', async () => {
    await openStep(await backend({ minimalLayout: ['Ctrl', '5'] }));
    expect(screen.getByRole('navigation', { name: 'Steps' })).toBeInTheDocument();
    await press('{Control>}2{/Control}');
    expect(screen.getByRole('navigation', { name: 'Steps' })).toBeInTheDocument();
    await press('{Control>}5{/Control}');
    await waitFor(() => {
      expect(screen.queryByRole('navigation', { name: 'Steps' })).toBeNull();
    });
    // The other layout keys keep their defaults.
    await press('{Control>}3{/Control}');
    expect(await screen.findByRole('complementary', { name: 'Guide' })).toBeInTheDocument();
  });

  it('F-19.7 Open in Rider follows its changed keys: Ctrl+Shift+R opens the shown file on S-06, Ctrl+Shift+O does not', async () => {
    const calls: [string, number, string | undefined][] = [];
    const client = await backend({ rider: ['Ctrl', 'Shift', 'R'] });
    renderApp(
      { screen: 'S-06' },
      {
        ...client,
        riderOpen: (file, line, session) => {
          calls.push([file, line, session]);
          return Promise.resolve();
        },
      },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Open in Rider' }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    await userEvent.click(document.body);
    await press('{Control>}{Shift>}O{/Shift}{/Control}');
    expect(calls).toHaveLength(1);
    await press('{Control>}{Shift>}R{/Shift}{/Control}');
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls[1]).toEqual(calls[0]);
  });

  it('F-19.7 Primary action follows its changed key: G starts step 1 on the plan, Enter does not', async () => {
    const client = await backend({ primary: ['G'] });
    const app = renderApp(
      { screen: 'S-02', sessionId: 's1' },
      {
        ...client,
        sessionMr: () => Promise.resolve(PLAN_SESSION),
        reviewPlan: (sessionId, onEvent) => client.reviewPlan(sessionId, onEvent),
      },
    );
    await screen.findByRole('heading', { name: 'Plan · 8 steps' });
    await userEvent.click(screen.getByRole('heading', { level: 1, name: PLAN_SESSION.mr.title }));
    const plan = pathFor({ screen: 'S-02', sessionId: 's1' });
    await press('{Enter}');
    expect(app.router.state.location.pathname).toBe(plan);
    await press('g');
    await waitFor(() => {
      expect(app.router.state.location.pathname).toBe(pathFor({ screen: 'S-03', sessionId: 's1' }));
    });
  });

  it('F-19.7 an action the app does not have and a keyless entry in the saved settings change nothing: N still moves to the next note', async () => {
    await openStep(await backend({ noSuchAction: ['N'], nextNote: [] }));
    await expectFocusedNote(PENDING);
    await press('n');
    await expectFocusedNote(STATUS);
  });
});
