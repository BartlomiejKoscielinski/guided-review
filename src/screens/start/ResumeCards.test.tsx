import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UnfinishedSession } from '../../ipc/types/UnfinishedSession';
import { renderApp } from '../../test/renderApp';

// "Pick up where you left off" on S-01 (F-04.1): the cards of Start.dc.html.

/** !471 of Start.dc.html: 5 of 9 steps reviewed, 3 drafts. */
const mr: UnfinishedSession = {
  id: 'mr-471',
  status: 'reviewing',
  mode: 'focus',
  updatedAt: '2026-10-14T08:00:00Z',
  resume: { screen: 'S-05', sessionId: 'mr-471' },
  source: { kind: 'mr', project: 'mobile/mobile-app', iid: 471 },
  title: 'Signature screen: field validation',
  reviewedSteps: 5,
  totalSteps: 9,
  drafts: 3,
};

/** The self-review of Start.dc.html, saved at the given local time. */
function selfReview(saved: Date): UnfinishedSession {
  return {
    id: 'self-1',
    status: 'reviewing',
    mode: 'focus',
    updatedAt: saved.toISOString(),
    resume: { screen: 'S-05', sessionId: 'self-1' },
    source: { kind: 'local', scope: { kind: 'uncommitted' } },
    title: 'chore/compiled-bindings',
    reviewedSteps: 2,
    totalSteps: 6,
    drafts: 0,
  };
}

/** Yesterday 18:40, seen from "today 20:00" (local time, so the test holds in any time zone). */
const NOW = new Date(2026, 9, 14, 20, 0);
const SAVED = new Date(2026, 9, 13, 18, 40);

function renderStart(sessions: UnfinishedSession[]) {
  return renderApp({ screen: 'S-01' }, { sessionsListUnfinished: () => Promise.resolve(sessions) });
}

const resume = () => screen.findByRole('region', { name: 'Pick up where you left off' });

afterEach(() => {
  vi.useRealTimers();
});

describe('S-01 Pick up where you left off', () => {
  it('F-04.1 lists the unfinished sessions under the heading, in the order the core returns them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    renderStart([mr, selfReview(SAVED)]);
    const region = within(await resume());
    expect(
      screen.getByRole('heading', { level: 2, name: 'Pick up where you left off' }),
    ).toBeInTheDocument();
    expect(region.getByText('Signature screen: field validation')).toBeInTheDocument();
    expect(region.getByText('chore/compiled-bindings')).toBeInTheDocument();
    const tags = region.getAllByText(/^(!471|local)$/).map((tag) => tag.textContent);
    expect(tags).toEqual(['!471', 'local']);
    expect(region.getAllByText('Continue')).toHaveLength(2);
  });

  it('F-04.1 an MR card says "5 of 9 steps · 3 drafts"', async () => {
    renderStart([mr]);
    const region = within(await resume());
    expect(region.getByText('!471')).toBeInTheDocument();
    expect(region.getByText('Signature screen: field validation')).toBeInTheDocument();
    expect(region.getByText('5 of 9 steps · 3 drafts')).toBeInTheDocument();
  });

  it('F-04.1 a self-review card says "Self-review · 2 of 6 steps · saved yesterday 18:40"', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    renderStart([selfReview(SAVED)]);
    const region = within(await resume());
    expect(region.getByText('local')).toBeInTheDocument();
    expect(region.getByText('chore/compiled-bindings')).toBeInTheDocument();
    expect(
      region.getByText('Self-review · 2 of 6 steps · saved yesterday 18:40'),
    ).toBeInTheDocument();
  });

  it('F-04.1 each card shows the progress of its own session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    renderStart([mr, { ...selfReview(SAVED), reviewedSteps: 6, totalSteps: 6 }]);
    const region = within(await resume());
    expect(region.getByText('5 of 9 steps · 3 drafts')).toBeInTheDocument();
    expect(region.getByText(/^Self-review · 6 of 6 steps · saved /)).toBeInTheDocument();
    expect(region.queryByText(/2 of 6 steps/)).toBeNull();
  });

  it('F-04.1 Continue opens the session of its card at its saved screen', async () => {
    const user = userEvent.setup();
    const { router } = renderStart([mr, selfReview(SAVED)]);
    const region = within(await resume());
    const [, second] = region.getAllByText('Continue');
    if (!second) throw new Error('No Continue on the second card');
    await user.click(second);
    expect(router.state.location.pathname).toBe('/session/self-1/summary');
  });

  it('F-04.1 until F-04.2 a card offers Continue only', async () => {
    renderStart([mr]);
    const region = within(await resume());
    expect(region.getAllByText('Continue')).toHaveLength(1);
    expect(region.queryByText('Only new changes')).toBeNull();
    expect(region.queryByText(/new commits?$/i)).toBeNull();
  });

  it('F-04.1 without unfinished sessions Start has no "Pick up where you left off" section', async () => {
    let asked = false;
    renderApp(
      { screen: 'S-01' },
      {
        sessionsListUnfinished: () => {
          asked = true;
          return Promise.resolve([]);
        },
      },
    );
    await waitFor(() => {
      expect(asked).toBe(true);
    });
    await act(async () => {
      await new Promise((done) => setTimeout(done, 50));
    });
    expect(screen.queryByText('Pick up where you left off')).toBeNull();
  });
});
