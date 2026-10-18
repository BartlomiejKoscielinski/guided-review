import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UnfinishedSession } from '../../ipc/types/UnfinishedSession';
import { renderApp } from '../../test/renderApp';

const session: UnfinishedSession = {
  id: 's-471',
  status: 'reviewing',
  mode: 'focus',
  updatedAt: '2026-10-11T09:00:00Z',
  resume: { screen: 'S-05', sessionId: 's-471' },
  source: { kind: 'mr', project: 'mobile/mobile-app', iid: 471 },
  title: 'Signature screen: field validation',
  reviewedSteps: 5,
  totalSteps: 9,
  drafts: 3,
};

function dock() {
  return within(screen.getByRole('navigation', { name: 'App' }));
}

function tile(name: string) {
  return dock().getByRole('button', { name: new RegExp(`^${name}`) });
}

describe('Dock', () => {
  it('F-30.2 dock shows MRs, Review, Changes and Settings in that order', () => {
    renderApp();
    const labels = dock()
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(labels).toEqual(['MRs', 'Review', 'Changes', 'Settings']);
  });

  it('F-30.2 active tile is filled with its area color', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(tile('MRs')).toHaveAttribute('aria-current', 'page');
    await user.click(tile('Changes'));
    expect(tile('Changes')).toHaveAttribute('aria-current', 'page');
    expect(tile('Changes')).toHaveAttribute('data-area', 'changes');
    expect(tile('MRs')).not.toHaveAttribute('aria-current');
  });

  it('F-30.2 Review is dimmed with a tooltip without an unfinished session', async () => {
    const user = userEvent.setup();
    const { router } = renderApp();
    const review = tile('Review');
    await waitFor(() => {
      expect(review).toHaveAttribute('aria-disabled', 'true');
    });
    expect(review).toHaveAttribute('title', 'No review open. Pick one in MRs.');
    await user.click(review);
    expect(router.state.location.pathname).toBe('/');
  });

  it('F-30.2 Review opens the most recent unfinished session at its last screen', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(
      { screen: 'S-01' },
      {
        sessionsListUnfinished: () => Promise.resolve([session]),
      },
    );
    await waitFor(() => {
      expect(tile('Review')).not.toHaveAttribute('aria-disabled');
    });
    await user.click(tile('Review'));
    expect(router.state.location.pathname).toBe('/session/s-471/summary');
    expect(tile('Review')).toHaveAttribute('aria-current', 'page');
  });

  it('F-12.7 Review resumes a newer drafts-only session at its summary, as Pick up lists it first', async () => {
    const user = userEvent.setup();
    const draftsOnly: UnfinishedSession = {
      ...session,
      id: 'd-482',
      status: 'draftsOnly',
      updatedAt: '2026-10-12T09:00:00Z',
      resume: { screen: 'S-05', sessionId: 'd-482' },
      source: { kind: 'mr', project: 'mobile/mobile-app', iid: 482 },
      title: 'mobile/mobile-app',
      reviewedSteps: 0,
      totalSteps: 0,
      drafts: 1,
    };
    const { router } = renderApp(
      { screen: 'S-01' },
      { sessionsListUnfinished: () => Promise.resolve([draftsOnly, session]) },
    );
    await waitFor(() => {
      expect(tile('Review')).not.toHaveAttribute('aria-disabled');
    });
    await user.click(tile('Review'));
    expect(router.state.location.pathname).toBe('/session/d-482/summary');
  });

  it('F-30.2 the Review tile lights up for a session opened after start, on the next screen', async () => {
    const user = userEvent.setup();
    let unfinished: UnfinishedSession[] = [];
    renderApp(
      { screen: 'S-01' },
      { sessionsListUnfinished: () => Promise.resolve(structuredClone(unfinished)) },
    );
    await waitFor(() => {
      expect(tile('Review')).toHaveAttribute('aria-disabled', 'true');
    });
    // A review starts (the core now lists it); moving to another screen saves ui.lastRoute,
    // which the list's resume routes depend on, so the dock asks again.
    unfinished = [session];
    await user.click(tile('Settings'));
    await waitFor(() => {
      expect(tile('Review')).not.toHaveAttribute('aria-disabled');
    });
  });

  it('F-30.2 Settings tile is purple and outlined when active', async () => {
    const user = userEvent.setup();
    renderApp();
    const settings = tile('Settings');
    expect(settings).toHaveAttribute('data-area', 'settings');
    expect(settings).toHaveAttribute('title', 'Settings · Ctrl+,');
    expect(settings).not.toHaveAttribute('aria-current');
    await user.click(settings);
    expect(tile('Settings')).toHaveAttribute('aria-current', 'page');
  });

  it('F-30.2 tiles are reachable with Tab and open with Enter', async () => {
    const user = userEvent.setup();
    const { router } = renderApp({ screen: 'S-07', section: 'general' });
    tile('Changes').focus();
    await user.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe('/changes');
    await user.tab();
    expect(tile('Settings')).toHaveFocus();
    await user.keyboard(' ');
    expect(router.state.location.pathname).toBe('/settings/general');
  });
});
