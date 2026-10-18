import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../../ipc/mock';
import type { UnfinishedSession } from '../../ipc/types/UnfinishedSession';
import { renderApp } from '../../test/renderApp';

// F-12.7 (docs/plans/M5.md, decision 15): a "drafts only" session, made by a draft from outside a
// review, is listed under "Pick up where you left off" while it holds an unpublished draft. Its
// card shows the draft count only (no steps, since it has none) and Continue opens S-05.

/** What the core lists for a drafts-only session: status draftsOnly, no steps, resume on S-05. */
function draftsOnly(drafts: number): UnfinishedSession {
  return {
    id: 'drafts-only-482',
    status: 'draftsOnly',
    mode: 'focus',
    updatedAt: '2026-10-14T08:00:00Z',
    resume: { screen: 'S-05', sessionId: 'drafts-only-482' },
    source: { kind: 'mr', project: 'mobile/mobile-app', iid: 482 },
    title: 'mobile/mobile-app',
    reviewedSteps: 0,
    totalSteps: 0,
    drafts,
  };
}

const region = () => screen.findByRole('region', { name: 'Pick up where you left off' });

describe('S-01 card of a drafts-only session (F-12.7)', () => {
  it('F-12.7 the card shows the draft count and no steps: "3 drafts"', async () => {
    renderApp(
      { screen: 'S-01' },
      { sessionsListUnfinished: () => Promise.resolve([draftsOnly(3)]) },
    );

    const card = within(await region());
    expect(await card.findByText('!482')).toBeInTheDocument();
    expect(card.getByText('3 drafts')).toBeInTheDocument();
    expect(card.queryByText(/step/)).toBeNull();
    expect(card.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('F-12.7 one draft reads "1 draft"', async () => {
    renderApp(
      { screen: 'S-01' },
      { sessionsListUnfinished: () => Promise.resolve([draftsOnly(1)]) },
    );

    const card = within(await region());
    expect(await card.findByText('1 draft')).toBeInTheDocument();
    expect(card.queryByText(/step/)).toBeNull();
  });

  it('F-12.7 a draft made outside a review puts its MR under Pick up, and Continue opens its S-05', async () => {
    const user = userEvent.setup();
    const ipc = createMockClient({ latencyMs: 0 });
    const body = 'Is the keystore secret set for this branch?';
    const draft = await ipc.draftsCreateForMr('mobile/mobile-app', 482, {
      body,
      position: null,
      severity: 'q',
    });
    const { router } = renderApp({ screen: 'S-01' }, ipc);

    const card = within(await region());
    expect(await card.findByText('!482')).toBeInTheDocument();
    expect(card.getByText('1 draft')).toBeInTheDocument();
    await user.click(card.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('heading', { name: /^summary$/i })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/session/${draft.sessionId}/summary`);
    expect(await within(await screen.findByRole('tabpanel')).findByText(body)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to steps' })).toBeNull();
  });
});
