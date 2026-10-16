import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient, type MockOptions } from '../../ipc/mock';
import type { AnalysisStatus } from '../../ipc/types/AnalysisStatus';
import type { ClaudeStatus } from '../../ipc/types/ClaudeStatus';
import type { ClaudeTaskEvent } from '../../ipc/types/ClaudeTaskEvent';
import type { StepAnalysis } from '../../ipc/types/StepAnalysis';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// F-08.8: the S-04 footer (Main.dc.html's <footer>): the shortcut hints on the left and, on the
// right, Claude's status with its square and which code Claude reads. The Claude line follows M4
// decision 9 (the steps after the current one whose analysis is ready, in the current order, with
// ranges; the step task running now; failed steps; "Claude: idle"; the Claude Code status words
// when it is unusable) and the code version decision 10 ("worktree @ <sha>", "repository @ <sha>",
// "working tree"). The square's colour is checked in tests/e2e/detailed-f08-8.spec.ts.

const SESSION = 'mock-mr-session-1';
const HEAD = 'a3f9c12b7e4d6f8091a2b3c4d5e6f708192a3b4c';

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

const status = (parts: Partial<AnalysisStatus> = {}): AnalysisStatus => ({
  ready: [],
  running: [],
  failed: [],
  codeAt: { kind: 'worktree', sha: HEAD },
  ...parts,
});

/** S-04 of the MR session on step 4 (`s4`, step 4 of 8 in contract → UI). */
async function openDetailed(client: Partial<IpcClient>) {
  const app = renderApp({ screen: 'S-04', sessionId: SESSION }, client);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId: SESSION })}?step=s4`);
  await screen.findByTestId('info-header');
  return app;
}

/** The S-04 footer (the shell's <main> holds it, so it has no contentinfo role). */
const footer = (): HTMLElement => {
  const el = document.querySelector('footer');
  if (!(el instanceof HTMLElement)) throw new Error('S-04 has no <footer>');
  return el;
};

const squash = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, '');

/**
 * The innermost element of the footer whose whole text is `text`; `loose` ignores spacing (the
 * spaces between a hint's keys).
 */
const piece = (text: string, loose = false) => {
  const norm = (t: string | null | undefined) => (loose ? squash(t) : (t ?? ''));
  const whole = (_content: string, el: Element | null) =>
    el !== null &&
    norm(el.textContent) === norm(text) &&
    Array.from(el.children).every((child) => norm(child.textContent) !== norm(text));
  whole.toString = () => `the whole text "${text}"`;
  return within(footer()).findByText(whole);
};

/** The footer's Claude line: the text of its innermost element that starts with "Claude". */
const claudeLine = () =>
  Array.from(footer().querySelectorAll('*'))
    .filter((el) => /^Claude/.test(el.textContent))
    .filter((el) => Array.from(el.children).every((c) => !/^Claude/.test(c.textContent)))
    .map((el) => el.textContent);

describe('S-04 footer (F-08.8)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-08.8 the footer hints J K hunk, [ ] step, N note, C comment, A ask, Space reviewed, ? all shortcuts', async () => {
    await openDetailed({ reviewAnalysisStatus: () => Promise.resolve(status()) });
    await waitFor(() => {
      expect(footer().querySelectorAll('kbd')).toHaveLength(9);
    });
    const keys = Array.from(footer().querySelectorAll('kbd')).map((k) => k.textContent);
    expect(keys).toEqual(['J', 'K', '[', ']', 'N', 'C', 'A', 'Space', '?']);
    expect(squash(footer().textContent)).toContain(
      squash('J K hunk [ ] step N note C comment A ask Space reviewed ? all shortcuts'),
    );
    for (const hint of [
      'J K hunk',
      '[ ] step',
      'N note',
      'C comment',
      'A ask',
      'Space reviewed',
      '? all shortcuts',
    ]) {
      expect(await piece(hint, true)).toBeInTheDocument();
    }
  });

  // Current step: s4, step 4 of 8 in contract → UI (s1 … s8).
  it.each<[string, Partial<AnalysisStatus>, string]>([
    [
      'the mock’s line',
      { ready: ['s5', 's6'], running: ['s7'] },
      'Claude: steps 5–6 ready, analyzing 7',
    ],
    ['one step ready', { ready: ['s5'] }, 'Claude: step 5 ready'],
    ['nothing ready, running or failed', {}, 'Claude: idle'],
    ['a failed step', { failed: ['s7'] }, 'Claude: step 7 failed'],
    ['ready only before or at the current step', { ready: ['s1', 's2', 's4'] }, 'Claude: idle'],
    ['ranges with a gap', { ready: ['s5', 's7', 's8'] }, 'Claude: steps 5, 7–8 ready'],
    ['the current step running', { running: ['s4'] }, 'Claude: analyzing 4'],
    ['a failed step before the current one', { failed: ['s2'] }, 'Claude: step 2 failed'],
    [
      'every part, ready then analyzing then failed',
      { ready: ['s6'], running: ['s4', 's5'], failed: ['s7', 's8'] },
      'Claude: step 6 ready, analyzing 4–5, steps 7–8 failed',
    ],
  ])('F-08.8 Claude status text: %s', async (_name, parts, text) => {
    await openDetailed({ reviewAnalysisStatus: () => Promise.resolve(status(parts)) });
    expect(await piece(text)).toBeInTheDocument();
    expect(claudeLine()).toEqual([text]);
  });

  it('F-08.8 the step numbers are the reader’s current order (tests first: s4 is step 5)', async () => {
    const storage = memoryStorage();
    const before = createMockClient({ latencyMs: 0, storage });
    await before.reviewPlan(SESSION, () => undefined);
    await before.reviewSetStrategy(SESSION, 'testsFirst');
    const client = createMockClient({ latencyMs: 0, storage });
    // tests first: s8, s1, s2, s3, s4, s5, s6, s7 - s8 is step 1, before the current step.
    await openDetailed({
      ...client,
      reviewAnalysisStatus: () => Promise.resolve(status({ ready: ['s8', 's5', 's6'] })),
    });
    expect(await piece('Claude: steps 6–7 ready')).toBeInTheDocument();
  });

  it.each<[string, AnalysisStatus['codeAt'], string]>([
    [
      'an MR: the review worktree at its head',
      { kind: 'worktree', sha: HEAD },
      'worktree @ a3f9c12',
    ],
    [
      'a self-review of commits or a branch: the repository at its head',
      { kind: 'repository', sha: '1b2c3d4e5f60718293a4b5c6d7e8f90112233445' },
      'repository @ 1b2c3d4',
    ],
    ['local changes: the working tree', { kind: 'workingTree' }, 'working tree'],
  ])('F-08.8 the code Claude reads: %s', async (_name, codeAt, text) => {
    await openDetailed({ reviewAnalysisStatus: () => Promise.resolve(status({ codeAt })) });
    expect(await piece(text)).toBeInTheDocument();
  });

  it.each<[string, ClaudeStatus]>([
    ['Claude Code: not signed in', { state: 'notSignedIn' }],
    ['Claude usage limit reached', { state: 'limited' }],
    ['Claude Code: not found', { state: 'notFound' }],
  ])('F-08.8 Claude Code unusable: the footer shows "%s"', async (text, claude) => {
    await openDetailed({
      claudeStatus: () => Promise.resolve(claude),
      reviewAnalysisStatus: () => Promise.resolve(status({ ready: ['s5', 's6'], running: ['s7'] })),
    });
    expect(await piece(text)).toBeInTheDocument();
    expect(within(footer()).queryByText(/^Claude: /)).toBeNull();
    // The code version stays: it does not depend on Claude Code.
    expect(await piece('worktree @ a3f9c12')).toBeInTheDocument();
  });

  it('F-08.8 while the status loads the footer shows the hints and no Claude line yet', async () => {
    await openDetailed({
      reviewAnalysisStatus: () => new Promise<AnalysisStatus>(() => undefined),
    });
    expect(await piece('? all shortcuts', true)).toBeInTheDocument();
    expect(claudeLine()).toEqual([]);
    expect(within(footer()).queryByText(/@/)).toBeNull();
  });

  it('F-08.8 when the status cannot be read the footer keeps the hints and leaves the Claude part out', async () => {
    const reviewAnalysisStatus = vi.fn<() => Promise<AnalysisStatus>>(() =>
      Promise.reject(
        new IpcError({ code: 'INVALID_INPUT', message: 'No such session.', retryable: false }),
      ),
    );
    await openDetailed({ reviewAnalysisStatus });
    await waitFor(() => {
      expect(reviewAnalysisStatus).toHaveBeenCalled();
    });
    expect(await piece('? all shortcuts', true)).toBeInTheDocument();
    expect(claudeLine()).toEqual([]);
    expect(within(footer()).queryByText(/@|working tree/)).toBeNull();
    expect(within(footer()).queryByText('No such session.')).toBeNull();
  });

  it('F-08.8 the Claude status is read again on the step task’s events (started, done)', async () => {
    const inner = createMockClient({ latencyMs: 0 });
    await inner.reviewPlan(SESSION, () => undefined);
    let emit: ((event: ClaudeTaskEvent<StepAnalysis>) => void) | undefined;
    let analysis: StepAnalysis | undefined;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reviewFindings: IpcClient['reviewFindings'] = async (sessionId, stepId, onEvent) => {
      emit = onEvent;
      analysis = await inner.reviewFindings(sessionId, stepId, () => undefined);
      onEvent({ kind: 'queued' });
      await gate;
      return analysis;
    };
    let current = status();
    const reviewAnalysisStatus = vi.fn(() => Promise.resolve(current));
    await openDetailed({ reviewFindings, reviewAnalysisStatus });
    expect(await piece('Claude: idle')).toBeInTheDocument();
    await waitFor(() => {
      expect(emit).toBeDefined();
    });

    current = status({ running: ['s4'] });
    act(() => {
      emit?.({ kind: 'started' });
    });
    expect(await piece('Claude: analyzing 4')).toBeInTheDocument();

    current = status({ ready: ['s4', 's5'] });
    act(() => {
      if (analysis) emit?.({ kind: 'done', result: analysis });
      release();
    });
    expect(await piece('Claude: step 5 ready')).toBeInTheDocument();
  });
});
