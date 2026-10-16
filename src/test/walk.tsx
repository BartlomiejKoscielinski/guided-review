import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vitest';
import { pathFor } from '../app/routes';
import type { IpcClient } from '../ipc/client';
import { createMockClient } from '../ipc/mock';
import type { FindingDecision } from '../ipc/types/FindingDecision';
import type { StepAnalysis } from '../ipc/types/StepAnalysis';
import { useFocusStore, type FocusLayout } from '../state/focus';
import { NO_REVIEW, useReviewStore } from '../state/review';
import { renderApp } from './renderApp';

// Helpers of the F-30.6 walk tests (M4 decisions 14 and 15): `↓`/`↑` over the changes of a step,
// `→`/`←` over its files, on S-03 and S-04 of !482 (the mock backend). Used by
// src/screens/step/ArrowWalk*.test.tsx and src/screens/detailed/ArrowWalk*.test.tsx.

export const SESSION = 'mock-mr-session-1';
// Step 4: one file, three hunks (S-03 shows the first as a closed fold "Fields and constructor").
export const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
// Step 5: two files, one hunk each.
export const CONVERTER = 'src/Mobile.App/Converters/PendingCountConverter.cs';
export const BANNER = 'src/Mobile.App/Views/OfflineBanner.xaml';
// Step 6: the first of its two files.
export const PHOTO_SERVICE = 'src/Mobile.App/Services/PhotoUploadService.cs';

export interface Calls {
  decide: [string, string, FindingDecision][];
  file: [string, string, string, boolean][];
  step: [string, string, boolean][];
  rider: [string, number, string | undefined][];
}

/** The mock backend recording what the keys write; `wrap` changes some commands for a test. */
async function backend(wrap?: (client: IpcClient) => IpcClient, plan = false) {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  if (plan) await ipc.reviewPlan(SESSION, () => undefined);
  const calls: Calls = { decide: [], file: [], step: [], rider: [] };
  const recording: IpcClient = {
    ...ipc,
    reviewDecide: (session, finding, decision) => {
      calls.decide.push([session, finding, decision]);
      return ipc.reviewDecide(session, finding, decision);
    },
    reviewMarkFile: (session, stepId, file, reviewed) => {
      calls.file.push([session, stepId, file, reviewed]);
      return ipc.reviewMarkFile(session, stepId, file, reviewed);
    },
    reviewMarkStep: (session, stepId, reviewed) => {
      calls.step.push([session, stepId, reviewed]);
      return ipc.reviewMarkStep(session, stepId, reviewed);
    },
    riderOpen: (file, line, session) => {
      calls.rider.push([file, line, session]);
      return Promise.resolve();
    },
  };
  return { client: wrap ? wrap(recording) : recording, calls };
}

export interface OpenOptions {
  layout?: FocusLayout;
  wrap?: (client: IpcClient) => IpcClient;
}

/** S-03 on a step of !482, opened as S-01 opens it. */
export async function openFocus(step: string, { layout = 'A', wrap }: OpenOptions = {}) {
  const { client, calls } = await backend(wrap);
  const app = renderApp({ screen: 'S-03', sessionId: SESSION }, client);
  await app.router.navigate(`/session/${SESSION}/step?step=${step}`);
  expect(await screen.findByText(`Step ${step.slice(1)} of 8`)).toBeInTheDocument();
  if (layout !== 'A') {
    act(() => {
      useFocusStore.getState().setLayout(layout);
    });
  }
  return { ...app, calls };
}

/** S-04 on a step of !482, its plan prepared as S-02 does. */
export async function openDetailed(step: string, { wrap }: OpenOptions = {}) {
  const { client, calls } = await backend(wrap, true);
  const app = renderApp({ screen: 'S-04', sessionId: SESSION }, client);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId: SESSION })}?step=${step}`);
  await screen.findByRole('heading', { level: 1 });
  expect(await screen.findByText(`Step ${step.slice(1)} / 8`)).toBeInTheDocument();
  return { ...app, calls };
}

/**
 * jsdom lays nothing out: a measured diff row is one line high, the column is tall and the screen
 * (`clientHeight`) is taller than any change, so the step's lines render and no change is "taller
 * than the screen" (the tall change scrolls in tests/e2e/step-f30-6.spec.ts, in a real layout).
 * Returns the function that puts `scrollIntoView` back.
 */
export function mockLayout(): () => void {
  useFocusStore.setState({ layout: 'A' });
  useReviewStore.setState({ key: null, ...NO_REVIEW });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute('data-index') ? 22 : 4000;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(4000);
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  return () => {
    if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  };
}

export const press = (keys: string) => userEvent.keyboard(keys);
export const down = () => press('{ArrowDown}');
export const up = () => press('{ArrowUp}');
export const right = () => press('{ArrowRight}');
export const left = () => press('{ArrowLeft}');

/** A key held down: the browser repeats it with `repeat` set (user-event cannot set the flag). */
export function held(key: string): void {
  fireEvent.keyDown(document.body, { key, code: key, repeat: true });
}

/** The change `↓`/`↑` made current: the one element marked `aria-current="true"` (its outline). */
export interface Current {
  /** The file section it is in. */
  file: string | null;
  text: string;
  /** The line numbers on its first row; a hunk header or a fold row has none. */
  lines: number[];
}

export function currentChange(): Current | null {
  const marked = document.querySelectorAll('[aria-current="true"]');
  expect(marked.length).toBeLessThanOrEqual(1);
  const element = marked[0];
  if (!element) return null;
  return {
    file: element.closest('section')?.getAttribute('aria-label') ?? null,
    text: element.textContent,
    lines: Array.from(element.querySelectorAll('[data-line-no]')).map((n) =>
      Number(n.getAttribute('data-line-no')),
    ),
  };
}

/** Waits until the current change is the one `check` accepts. */
export async function expectCurrent(check: (current: Current) => void) {
  await waitFor(() => {
    const current = currentChange();
    expect(current).not.toBeNull();
    if (current) check(current);
  });
}

/** Waits until the current change is the first row of a file's hunk starting at `line`. */
export const expectCurrentLine = (file: string, line: number) =>
  expectCurrent((current) => {
    expect(current.file).toBe(file);
    expect(current.lines).toContain(line);
  });

/** The Reviewed toggle of a file's header (S-03) or sticky bar (S-04). */
export const fileToggle = (path: string) =>
  within(screen.getByRole('region', { name: path })).getByRole('button', {
    name: `Mark ${path} reviewed`,
  });

export async function expectFilePressed(path: string, pressed: boolean) {
  await waitFor(() => {
    expect(fileToggle(path)).toHaveAttribute('aria-pressed', String(pressed));
  });
}

/** The step's own button: Mark reviewed, Reviewed once all its files are marked. */
export const stepButton = () => screen.getByRole('button', { name: /^(Mark reviewed|Reviewed)/ });

export async function expectStepReviewed(reviewed: boolean) {
  await waitFor(() => {
    expect(stepButton()).toHaveAttribute('aria-pressed', String(reviewed));
  });
}

/** !482 with the note f4 moved from line 54 (the second hunk of step 4) into the third hunk. */
export function noteInThirdHunk(client: IpcClient): IpcClient {
  const moved = (analysis: StepAnalysis): StepAnalysis => ({
    ...analysis,
    findings: analysis.findings.map((f) => (f.id === 'f4' ? { ...f, line: 70 } : f)),
  });
  return {
    ...client,
    reviewFindings: async (session, step, onEvent) =>
      moved(
        await client.reviewFindings(session, step, (event) => {
          onEvent(event.kind === 'done' ? { ...event, result: moved(event.result) } : event);
        }),
      ),
  };
}

/** A commit session (a self-review) with its plan prepared as S-02 does: S-05 has content. */
export async function selfReview() {
  const ipc = createMockClient({ latencyMs: 0, storage: null });
  await ipc.repoPick();
  const { sessionId } = await ipc.sessionOpenCommit({ to: 'a3f9c12' });
  await ipc.reviewPlan(sessionId, () => undefined);
  return { ipc, sessionId };
}
