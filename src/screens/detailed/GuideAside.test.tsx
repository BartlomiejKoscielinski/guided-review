import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient, type MockOptions } from '../../ipc/mock';
import type { SessionMr } from '../../ipc/types/SessionMr';
import type { StepAnalysis } from '../../ipc/types/StepAnalysis';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// F-08.7: S-04's Guide aside (Main.dc.html) - "Code notes" in line order with the focused note
// marked (`N` cycles, its callout is brought into view), "For you to judge" with `ticked/total`
// (`session_set_checklist`), and "Analysis context": the files Claude read, each with its place
// ("step N" in the reader's order, "skim", "outside MR"; M4 decision 8) and Claude's reason as
// the tooltip. Each section is a region named by its heading. The Ask box is in AskBox.test.tsx.

const SESSION = 'mock-mr-session-1';
const CALLOUT = 'Claude note at this line';

/** Step 4's notes (!482's SendPhoto) in line order, as the mock's Code notes list them. */
const NOTES = [
  { n: '1', tag: 'Question', line: 'L46', title: 'The whole photo goes into SQLite as byte[]' },
  { n: '2', tag: 'Should fix', line: 'L49', title: 'PendingCount won’t refresh after upload' },
  { n: '3', tag: 'Minor', line: 'L51', title: 'Status texts are hardcoded' },
  {
    n: '4',
    tag: 'Should fix',
    line: 'L54',
    title: 'catch (Exception) also catches camera cancellation',
  },
] as const;
type Note = (typeof NOTES)[number];
const [F1, F2, F3, F4] = NOTES;

const CHECKS = [
  'Matches the MR description: the photo is saved even without network',
  'The “Saved offline…” message is agreed with PO or UX',
  'On a device: a double tap doesn’t add two entries',
] as const;

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

/** A mock backend of its own, with the session's plan prepared as S-02 does. */
async function backend(kind: 'mr' | 'commit' = 'mr') {
  const ipc = createMockClient({ latencyMs: 0, storage: memoryStorage() });
  await ipc.repoPick();
  const sessionId =
    kind === 'mr' ? SESSION : (await ipc.sessionOpenCommit({ to: 'a3f9c12' })).sessionId;
  await ipc.reviewPlan(sessionId, () => undefined);
  return { ipc, sessionId };
}

async function openDetailed(client: Partial<IpcClient>, sessionId = SESSION, step = 's4') {
  const app = renderApp({ screen: 'S-04', sessionId }, client);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId })}?step=${step}`);
  await screen.findByRole('heading', { level: 1 });
  return app;
}

const squash = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
const guide = () => within(screen.getByRole('complementary', { name: 'Guide' }));
const findSection = async (name: string) => within(await guide().findByRole('region', { name }));
const noSection = (name: string) => {
  expect(guide().queryByRole('region', { name })).toBeNull();
};

/** The innermost element whose whole text reads `text` (pieces may sit in nested spans). */
function textIn(root: HTMLElement, text: string): HTMLElement {
  const all = Array.from(root.querySelectorAll<HTMLElement>('*')).filter(
    (el) => squash(el.textContent) === text,
  );
  const inner = all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
  const [found] = inner;
  if (!found || inner.length > 1) {
    throw new Error(`expected one "${text}" in the aside, found ${String(inner.length)}`);
  }
  return found;
}

/** The Code notes rows: one button per note, its name holding the note's title. */
function rowsNow(): HTMLElement[] {
  const notes = within(guide().getByRole('region', { name: 'Code notes' }));
  return NOTES.map((note) =>
    notes.getByRole('button', { name: (name) => name.includes(note.title) }),
  );
}
async function rows(): Promise<HTMLElement[]> {
  await waitFor(() => rowsNow());
  return rowsNow();
}
const row = async (note: Note) => (await rows())[NOTES.indexOf(note)] as HTMLElement;
const callout = () => screen.findByRole('region', { name: CALLOUT });

async function expectFocused(note: Note) {
  await waitFor(() => {
    for (const other of rowsNow()) {
      const on = squash(other.textContent).includes(note.title);
      expect(other).toHaveAttribute('aria-pressed', on ? 'true' : 'false');
    }
  });
  expect(within(await callout()).getByText(note.title, { exact: true })).toBeInTheDocument();
}

describe('S-04 Guide aside (F-08.7)', () => {
  let scrolled: ReturnType<typeof vi.fn>;
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    // jsdom lays nothing out: a measured diff row (`data-index`) is one line high and the column
    // is tall, so all of step 4's lines (the notes sit at L46-L54) render, as in NoteCallout.test.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
    // jsdom has no scrollIntoView; record which element is brought into view.
    scrolled = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrolled,
    });
  });

  afterEach(() => {
    if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  /** The focused note's callout (or an element holding it) was scrolled into view. */
  async function expectCalloutBroughtIntoView() {
    const shown = await callout();
    await waitFor(() => {
      const targets = scrolled.mock.contexts as unknown[];
      expect(targets.some((el) => el instanceof Node && (el === shown || el.contains(shown)))).toBe(
        true,
      );
    });
  }

  it('F-08.7 Code notes lists the step’s notes in line order: number, tag, line and title; "in line order · N"', async () => {
    await openDetailed((await backend()).ipc);
    const notes = await findSection('Code notes');
    expect(notes.getByRole('heading', { name: 'Code notes' })).toBeInTheDocument();
    const region = guide().getByRole('region', { name: 'Code notes' });
    expect(textIn(region, 'in line order · N')).toBeInTheDocument();

    const listed = await rows();
    // Line order: each row comes after the one before it.
    for (const [i, el] of listed.entries()) {
      const next = listed[i + 1];
      if (next)
        expect(el.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    for (const [i, note] of NOTES.entries()) {
      const el = within(listed[i] as HTMLElement);
      expect(el.getByText(note.n, { exact: true })).toBeInTheDocument();
      expect(el.getByText(note.tag, { exact: true })).toBeInTheDocument();
      expect(el.getByText(note.line, { exact: true })).toBeInTheDocument();
      expect(el.getByText(note.title, { exact: true })).toBeInTheDocument();
    }
  });

  it('F-08.7 the focused note is marked in Code notes; a click on another moves the focus and brings its callout into view', async () => {
    await openDetailed((await backend()).ipc);
    // Step 4 opens on its first Should fix (note 2), as the callout does (F-08.6).
    await expectFocused(F2);

    scrolled.mockClear();
    await userEvent.click(await row(F1));
    await expectFocused(F1);
    await expectCalloutBroughtIntoView();
  });

  it('F-08.7 N moves the focus to the next note in line order and wraps from the last to the first', async () => {
    await openDetailed((await backend()).ipc);
    await expectFocused(F2);

    scrolled.mockClear();
    await userEvent.keyboard('n');
    await expectFocused(F3);
    await expectCalloutBroughtIntoView();

    await userEvent.keyboard('n');
    await expectFocused(F4);
    await userEvent.keyboard('n');
    await expectFocused(F1);
    await userEvent.keyboard('n');
    await expectFocused(F2);
  });

  it('F-08.7 in a text field N types instead of moving the focus', async () => {
    await openDetailed((await backend()).ipc);
    await expectFocused(F2);
    const ask = guide().getByRole('textbox', { name: 'Ask about this step or the selected code' });
    await userEvent.click(ask);
    await userEvent.keyboard('n');
    expect(ask).toHaveValue('n');
    await expectFocused(F2);
  });

  it('F-08.7 For you to judge: the step’s checks with ticked/total; a tick is kept with the session', async () => {
    const { ipc } = await backend();
    const sessionSetChecklist = vi.fn<IpcClient['sessionSetChecklist']>((...args) =>
      ipc.sessionSetChecklist(...args),
    );
    await openDetailed({ ...ipc, sessionSetChecklist });
    const judge = await findSection('For you to judge');
    expect(judge.getByRole('heading', { name: 'For you to judge' })).toBeInTheDocument();
    expect(judge.getByText('0/3', { exact: true })).toBeInTheDocument();
    // The step's checks in Claude's order, each a checkbox named by its text.
    const boxes = judge.getAllByRole('checkbox');
    expect(boxes).toEqual(CHECKS.map((text) => judge.getByRole('checkbox', { name: text })));
    for (const box of boxes) expect(box).not.toBeChecked();

    await userEvent.click(judge.getByRole('checkbox', { name: CHECKS[0] }));
    expect(judge.getByRole('checkbox', { name: CHECKS[0] })).toBeChecked();
    expect(await judge.findByText('1/3', { exact: true })).toBeInTheDocument();
    expect(sessionSetChecklist).toHaveBeenLastCalledWith(SESSION, 's4', [CHECKS[0]]);

    await userEvent.click(judge.getByRole('checkbox', { name: CHECKS[2] }));
    expect(await judge.findByText('2/3', { exact: true })).toBeInTheDocument();
    expect(sessionSetChecklist).toHaveBeenLastCalledWith(SESSION, 's4', [CHECKS[0], CHECKS[2]]);

    await userEvent.click(judge.getByRole('checkbox', { name: CHECKS[0] }));
    expect(await judge.findByText('1/3', { exact: true })).toBeInTheDocument();
    expect(sessionSetChecklist).toHaveBeenLastCalledWith(SESSION, 's4', [CHECKS[2]]);
  });

  it('F-08.7 the checklist opens with the ticks kept for the step', async () => {
    const { ipc } = await backend();
    await ipc.sessionSetChecklist(SESSION, 's4', [CHECKS[1]]);
    await openDetailed(ipc);
    const judge = await findSection('For you to judge');
    expect(await judge.findByRole('checkbox', { name: CHECKS[1] })).toBeChecked();
    expect(judge.getByRole('checkbox', { name: CHECKS[0] })).not.toBeChecked();
    expect(judge.getByText('1/3', { exact: true })).toBeInTheDocument();
  });

  it('F-08.7 Analysis context: "Files Claude read in the worktree:", each file with its place; full path and Claude’s reason as the tooltip', async () => {
    await openDetailed((await backend()).ipc);
    const context = await findSection('Analysis context');
    expect(context.getByRole('heading', { name: 'Analysis context' })).toBeInTheDocument();
    expect(context.getByText('Files Claude read in the worktree:')).toBeInTheDocument();
    const root = screen.getByRole('region', { name: 'Analysis context' });
    const entries = [
      [
        'Uploads/IUploadQueue.cs · step 1',
        'src/Mobile.Core/Uploads/IUploadQueue.cs · The queue contract.',
      ],
      [
        'Uploads/UploadWorker.cs · step 3',
        'src/Mobile.Infrastructure/Uploads/UploadWorker.cs · Who empties the queue.',
      ],
      [
        'Services/CameraService.cs · outside MR',
        'src/Mobile.App/Services/CameraService.cs · What CaptureAsync throws.',
      ],
      [
        'Strings/AppResources.resx · skim',
        'src/Mobile.App/Resources/Strings/AppResources.resx · Existing text keys.',
      ],
    ] as const;
    const found = entries.map(([text]) => textIn(root, text));
    for (const [i, [, tooltip]] of entries.entries()) {
      const el = found[i] as HTMLElement;
      // The tooltip sits on the entry or the element around it.
      expect(el.closest('[title]')).toHaveAttribute('title', tooltip);
      const next = found[i + 1];
      if (next)
        expect(el.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // Places only: the files are not links or buttons.
    expect(context.queryByRole('button')).toBeNull();
    expect(context.queryByRole('link')).toBeNull();
  });

  it('F-08.7 "step N" is the step’s number in the reader’s order', async () => {
    const { ipc } = await backend();
    await ipc.reviewSetStrategy(SESSION, 'testsFirst');
    await openDetailed(ipc);
    await findSection('Analysis context');
    const root = screen.getByRole('region', { name: 'Analysis context' });
    // Tests first: s8 s1 s2 s3 s4 …, so the queue (s1) is step 2 and the worker (s3) step 4.
    expect(textIn(root, 'Uploads/IUploadQueue.cs · step 2')).toBeInTheDocument();
    expect(textIn(root, 'Uploads/UploadWorker.cs · step 4')).toBeInTheDocument();
    expect(textIn(root, 'Strings/AppResources.resx · skim')).toBeInTheDocument();
  });

  it('F-08.7 self-review: "Files Claude read in the repository:" and "outside the change"', async () => {
    const { ipc, sessionId } = await backend('commit');
    await openDetailed(ipc, sessionId);
    const context = await findSection('Analysis context');
    expect(await context.findByText('Files Claude read in the repository:')).toBeInTheDocument();
    expect(context.queryByText('Files Claude read in the worktree:')).toBeNull();
    const root = screen.getByRole('region', { name: 'Analysis context' });
    expect(textIn(root, 'Services/CameraService.cs · outside the change')).toBeInTheDocument();
    expect(textIn(root, 'Uploads/IUploadQueue.cs · step 1')).toBeInTheDocument();
    expect(context.queryByText(/outside MR/)).toBeNull();
  });

  it('F-08.7 while the session is looked up Analysis context waits; Code notes and the checklist show', async () => {
    const { ipc } = await backend();
    await openDetailed({
      ...ipc,
      sessionMr: () => new Promise<SessionMr | null>(() => undefined),
    });
    await rows();
    await findSection('For you to judge');
    // Neither the worktree copy nor the repository copy is guessed (as the callout, F-08.6).
    noSection('Analysis context');
    expect(guide().queryByText(/Files Claude read/)).toBeNull();
  });

  it('F-08.7 when the session lookup fails Analysis context keeps the MR copy', async () => {
    const { ipc } = await backend();
    await openDetailed({
      ...ipc,
      sessionMr: () =>
        Promise.reject(
          new IpcError({
            code: 'INTERNAL',
            message: 'The session could not be read.',
            retryable: false,
          }),
        ),
    });
    const context = await findSection('Analysis context');
    expect(await context.findByText('Files Claude read in the worktree:')).toBeInTheDocument();
    const root = screen.getByRole('region', { name: 'Analysis context' });
    expect(textIn(root, 'Services/CameraService.cs · outside MR')).toBeInTheDocument();
  });

  it('F-08.7 a step where nothing stood out: Code notes says so, no checklist, no Analysis context', async () => {
    await openDetailed((await backend()).ipc, SESSION, 's5');
    const notes = await findSection('Code notes');
    expect(
      await notes.findByText('Nothing stood out. Read it yourself, though.'),
    ).toBeInTheDocument();
    expect(notes.queryAllByRole('button')).toEqual([]);
    noSection('For you to judge');
    noSection('Analysis context');
  });

  it('F-08.7 while Claude reads the step Code notes says "Claude is reading this step…"', async () => {
    const { ipc } = await backend();
    await openDetailed({
      ...ipc,
      reviewFindings: () => new Promise<StepAnalysis>(() => undefined),
    });
    const notes = await findSection('Code notes');
    expect(await notes.findByText('Claude is reading this step…')).toBeInTheDocument();
    noSection('For you to judge');
    noSection('Analysis context');
  });
});
