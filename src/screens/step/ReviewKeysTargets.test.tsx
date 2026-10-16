import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import { createMockClient } from '../../ipc/mock';
import type { FileDiff } from '../../ipc/types/FileDiff';
import type { Finding } from '../../ipc/types/Finding';
import type { Hunk } from '../../ipc/types/Hunk';
import type { Line } from '../../ipc/types/Line';
import { useFocusStore } from '../../state/focus';
import { NO_REVIEW, useReviewStore } from '../../state/review';
import { renderApp } from '../../test/renderApp';
import { riderTarget } from './useReviewKeys';

// Where the review keys act (F-30.6, M4 decisions 13 and 14): C after ↓/↑ opens the composer in
// the current hunk, Ctrl+Shift+O follows the Open in Rider buttons (nothing for a deleted file, a
// removed line opens its hunk's first new line), and A with an answer card open keeps its answer.

const SESSION = 'mock-mr-session-1';
const CONVERTER = 'src/Mobile.App/Converters/PendingCountConverter.cs';
const BANNER = 'src/Mobile.App/Views/OfflineBanner.xaml';
const HUNK_3 = 'lines 61–74 · RetryAsync';

const press = (keys: string) => userEvent.keyboard(keys);

/** S-03 on `step` of the MR session, opened as S-01 opens it. */
async function openFocus(step: string) {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const app = renderApp({ screen: 'S-03', sessionId: SESSION }, ipc);
  await app.router.navigate(`/session/${SESSION}/step?step=${step}`);
  expect(await screen.findByText(`Step ${step.slice(1)} of 8`)).toBeInTheDocument();
  return app;
}

/** S-04 on `step` of the MR session, its plan prepared as S-02 does. */
async function openDetailed(step: string) {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  await ipc.reviewPlan(SESSION, () => undefined);
  const app = renderApp({ screen: 'S-04', sessionId: SESSION }, ipc);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId: SESSION })}?step=${step}`);
  expect(await screen.findByText(`Step ${step.slice(1)} / 8`)).toBeInTheDocument();
  return app;
}

/** The change ↓/↑ made current: the one element marked `aria-current="true"`. */
async function expectCurrent(check: (marked: Element) => void) {
  await waitFor(() => {
    const marked = document.querySelectorAll('[aria-current="true"]');
    expect(marked).toHaveLength(1);
    if (marked[0]) check(marked[0]);
  });
}

/** The open composer's line ("Comment on L65") and the file section it is drawn in. */
async function composerAt(): Promise<{ line: number; file: string | null }> {
  const card = await screen.findByLabelText(/^Comment on (old )?L\d+$/);
  const label = card.getAttribute('aria-label') ?? '';
  return {
    line: Number(/L(\d+)$/.exec(label)?.[1]),
    file: card.closest('section')?.getAttribute('aria-label') ?? null,
  };
}

describe('review key targets (F-30.6)', () => {
  let original: PropertyDescriptor | undefined;

  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    useReviewStore.setState({ key: null, ...NO_REVIEW });
    // jsdom lays nothing out: a measured diff row is one line high and the column is tall.
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

  it('F-30.6 C after ↓ opens the composer at the current change', async () => {
    await openFocus('s5');
    await press('{ArrowDown}');
    await press('{ArrowDown}');
    await expectCurrent((marked) => {
      expect(marked.closest('section')).toHaveAttribute('aria-label', BANNER);
    });
    await press('c');
    // The step's first changed line is in the converter; the current hunk is the banner's.
    expect((await composerAt()).file).toBe(BANNER);
  });

  it('F-30.6 C without ↓ still opens the composer at the step’s first changed line', async () => {
    await openFocus('s5');
    await press('c');
    expect((await composerAt()).file).toBe(CONVERTER);
  });

  it('F-30.6 C after ↓ on S-04 opens the composer in the current change', async () => {
    await openDetailed('s4');
    await press('{ArrowDown}');
    await press('{ArrowDown}');
    await press('{ArrowDown}');
    await expectCurrent((marked) => {
      expect(marked).toHaveTextContent(HUNK_3);
    });
    await press('c');
    const { line } = await composerAt();
    expect(line).toBeGreaterThanOrEqual(61);
    expect(line).toBeLessThanOrEqual(74);
  });

  it('F-30.6 A with an answer card open focuses its question field and keeps the answer', async () => {
    await openFocus('s4');
    await press('a');
    const card = await screen.findByRole('article', { name: 'Claude answer' });
    const input = within(card).getByRole('textbox', { name: 'Ask Claude about this step' });
    await userEvent.type(input, 'Why a queue here?');
    await userEvent.click(within(card).getByRole('button', { name: 'Ask Claude' }));
    expect(within(card).getByText('Why a queue here?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('heading', { level: 1 }));
    expect(input).not.toHaveFocus();

    await press('a');
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
    // The same card: the question and its thread stay.
    expect(screen.getByRole('article', { name: 'Claude answer' })).toBe(card);
    expect(within(card).getByText('Why a queue here?')).toBeInTheDocument();
  });

  it('F-30.6 A in layout C with an answer card open focuses that card and keeps the answer', async () => {
    await openFocus('s4');
    act(() => {
      useFocusStore.getState().setLayout('C');
    });
    const guide = screen.getByRole('complementary', { name: 'Guide' });
    await userEvent.type(
      within(guide).getByRole('textbox', { name: 'Ask Claude about this step' }),
      'Why a queue here?{Enter}',
    );
    const card = await within(guide).findByRole('article', { name: 'Claude answer' });
    expect(within(card).getByText('Why a queue here?')).toBeInTheDocument();
    act(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });

    await press('a');
    const input = within(card).getByRole('textbox', { name: 'Ask Claude about this step' });
    await waitFor(() => {
      expect(input).toHaveFocus();
    });
    expect(within(guide).getByRole('article', { name: 'Claude answer' })).toBe(card);
    expect(within(card).getByText('Why a queue here?')).toBeInTheDocument();
  });
});

// Ctrl+Shift+O's target, as the Open in Rider buttons decide it (FileBar, DiffPane).

const line = (kind: Line['kind'], oldNo?: number, newNo?: number): Line => ({
  kind,
  ...(oldNo === undefined ? {} : { oldNo }),
  ...(newNo === undefined ? {} : { newNo }),
  text: 'x',
  emphasis: [],
});

const hunk = (id: string, old: [number, number], next: [number, number], lines: Line[]): Hunk => ({
  id,
  oldStart: old[0],
  oldLines: old[1],
  newStart: next[0],
  newLines: next[1],
  header: '',
  lines,
  fileLevel: false,
  stagedDiffers: false,
});

const fileOf = (path: string, status: FileDiff['status'], hunks: Hunk[]): FileDiff => ({
  ...(status === 'deleted' ? { oldPath: path } : { oldPath: path, newPath: path }),
  status,
  binary: false,
  additions: 1,
  deletions: 1,
  layer: 'core',
  hunks,
  lineStaging: true,
});

const GONE = 'src/Core/Gone.cs';
const KEPT = 'src/Core/Kept.cs';
const deleted = fileOf(GONE, 'deleted', [
  hunk('d1', [1, 2], [0, 0], [line('del', 1), line('del', 2)]),
]);
const modified = fileOf(KEPT, 'modified', [
  hunk(
    'm1',
    [10, 3],
    [20, 2],
    [line('ctx', 10, 20), line('del', 11), line('del', 12), line('add', undefined, 21)],
  ),
  hunk('m2', [40, 2], [45, 1], [line('ctx', 40, 45), line('del', 41)]),
]);

const note = (file: string, side: Finding['side'], at: number): Finding => ({
  id: 'f1',
  stepId: 's1',
  severity: 'fix',
  kind: 'bug',
  title: 'A note',
  body: '',
  file,
  side,
  line: at,
  evidence: [],
  suggestedComment: '',
  fingerprint: 'fp',
  decision: 'open',
});

describe('Ctrl+Shift+O target (F-30.6)', () => {
  it('F-30.6 Ctrl+Shift+O does nothing on a deleted file’s current hunk', () => {
    const files = [modified, deleted];
    expect(riderTarget(files, null, undefined, { file: GONE, hunk: 'd1' })).toBeNull();
  });

  it('F-30.6 Ctrl+Shift+O does nothing when the step’s first hunk is in a deleted file', () => {
    expect(riderTarget([deleted, modified], null, undefined, null)).toBeNull();
  });

  it('F-30.6 Ctrl+Shift+O does nothing on a selection or note in a deleted file', () => {
    const files = [modified, deleted];
    const selection = { file: GONE, side: 'old' as const, start: 1, end: 2 };
    expect(riderTarget(files, selection, undefined, null)).toBeNull();
    expect(riderTarget(files, null, note(GONE, 'old', 2), null)).toBeNull();
  });

  it('F-30.6 Ctrl+Shift+O on removed lines opens their hunk’s first new line', () => {
    const files = [modified];
    // Old lines 40-41 are in m2, whose new side starts at 45; old line 12 is in m1 (new 20).
    const selection = { file: KEPT, side: 'old' as const, start: 41, end: 40 };
    expect(riderTarget(files, selection, undefined, null)).toEqual({ file: KEPT, line: 45 });
    expect(riderTarget(files, null, note(KEPT, 'old', 12), null)).toEqual({
      file: KEPT,
      line: 20,
    });
  });

  it('F-30.6 Ctrl+Shift+O on new lines opens the first of them', () => {
    const selection = { file: KEPT, side: 'new' as const, start: 21, end: 20 };
    expect(riderTarget([modified], selection, undefined, null)).toEqual({ file: KEPT, line: 20 });
    expect(riderTarget([modified], null, note(KEPT, 'new', 21), null)).toEqual({
      file: KEPT,
      line: 21,
    });
    expect(riderTarget([modified], null, undefined, { file: KEPT, hunk: 'm2' })).toEqual({
      file: KEPT,
      line: 45,
    });
  });
});
