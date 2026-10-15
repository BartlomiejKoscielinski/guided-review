import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import { ANSWER_PARTS } from '../../ipc/mock/fixtures/review';
import type { LineSelection } from '../../ipc/types/LineSelection';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// F-08.7: the Guide aside's Ask box (Main.dc.html): "Ask about this step or the selected code",
// the current context ("step 4", with lines "step 4 · L46–L57") and Ask `Ctrl+↵`. M4 decision 7:
// the answer card shows in the aside right above the Ask box; Ask Claude on a callout and `A`
// focus the Ask box with that context. Follow-ups are asked from the same box (F-10.2).

const SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const ASK = 'Ask about this step or the selected code';
const PLACEHOLDER = 'E.g. can the worker upload the same photo twice?';
const ANSWER = ANSWER_PARTS.join('');
const QUESTION = 'Can the worker upload the same photo twice?';

interface AskCall {
  step: string;
  question: string;
  selection: LineSelection | null;
}

/** A mock backend of its own, with the plan prepared, whose `reviewAsk` records each question. */
async function backend() {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  await ipc.reviewPlan(SESSION, () => undefined);
  const calls: AskCall[] = [];
  const reviewAsk: IpcClient['reviewAsk'] = (session, step, question, selection, onEvent) => {
    calls.push({ step, question, selection });
    return ipc.reviewAsk(session, step, question, selection, onEvent);
  };
  return { client: { ...ipc, reviewAsk }, calls };
}

async function openDetailed(client: Partial<IpcClient>) {
  const app = renderApp({ screen: 'S-04', sessionId: SESSION }, client);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId: SESSION })}?step=s4`);
  await screen.findByRole('heading', { level: 1 });
  return app;
}

const squash = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
const guideEl = () => screen.getByRole('complementary', { name: 'Guide' });
const guide = () => within(guideEl());
const askBox = () => guide().getByRole('textbox', { name: ASK });
const askButton = () => guide().getByRole('button', { name: 'Ask Ctrl+↵' });
const ctrlEnter = () => userEvent.keyboard('{Control>}{Enter}{/Control}');
const follows = (before: Node, after: Node) =>
  (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

/** The aside's context label reads exactly `text` (pieces may sit in nested spans). */
async function expectContext(text: string) {
  await waitFor(() => {
    // The places in Analysis context ("· step 1") are not the context.
    const places = guide().queryByRole('region', { name: 'Analysis context' });
    const all = Array.from(guideEl().querySelectorAll<HTMLElement>('*')).filter(
      (el) => !places?.contains(el) && /^step \d+( · L\d+(–L\d+)?)?$/.test(squash(el.textContent)),
    );
    const inner = all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
    expect(inner.map((el) => squash(el.textContent))).toEqual([text]);
  });
}

/** The number cell of an added line in S-03's diff. */
function addLine(no: number): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `[data-kind="add"] [data-line-no="${String(no)}"]`,
  );
  if (!found) throw new Error(`added line ${String(no)} is not in the diff`);
  return found;
}

describe('S-04 Ask box (F-08.7)', () => {
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
  });

  it('F-08.7 the Ask box: its label, placeholder, the context "step 4" and Ask Ctrl+↵', async () => {
    await openDetailed((await backend()).client);
    const box = await guide().findByRole('textbox', { name: ASK });
    expect(box).toHaveAttribute('placeholder', PLACEHOLDER);
    expect(guide().getByText(ASK)).toBeInTheDocument();
    await expectContext('step 4');
    const ask = askButton();
    expect(within(ask).getByText('Ctrl+↵')).toBeInTheDocument();
    // Nothing to ask yet: the button waits for a question.
    expect(ask).toBeDisabled();
    // No answer card before a question.
    expect(guide().queryByRole('article', { name: 'Claude answer' })).toBeNull();
  });

  it('F-08.7 Ctrl+↵ asks about the step; the answer streams into the card right above the Ask box', async () => {
    const { client, calls } = await backend();
    await openDetailed(client);
    await userEvent.click(await guide().findByRole('textbox', { name: ASK }));
    await userEvent.keyboard(QUESTION);
    await ctrlEnter();

    const card = await guide().findByRole('article', { name: 'Claude answer' });
    expect(within(card).getByText(QUESTION)).toBeInTheDocument();
    expect(await within(card).findByText(ANSWER)).toBeInTheDocument();
    expect(calls).toEqual([{ step: 's4', question: QUESTION, selection: null }]);
    // The card sits above the box, and the box is ready for the next question.
    expect(follows(card, askBox())).toBe(true);
    expect(askBox()).toHaveValue('');
    // One place to type in the aside: the card has no input of its own here.
    expect(guide().getAllByRole('textbox')).toEqual([askBox()]);
  });

  it('F-08.7 the Ask button asks too; a follow-up from the Ask box continues in the same card', async () => {
    const { client, calls } = await backend();
    await openDetailed(client);
    await userEvent.type(await guide().findByRole('textbox', { name: ASK }), QUESTION);
    expect(askButton()).toBeEnabled();
    await userEvent.click(askButton());
    const card = await guide().findByRole('article', { name: 'Claude answer' });
    expect(await within(card).findByText(ANSWER)).toBeInTheDocument();

    await userEvent.type(askBox(), 'And after a restart?');
    await ctrlEnter();
    expect(await within(card).findByText('And after a restart?')).toBeInTheDocument();
    expect(guide().getAllByRole('article', { name: 'Claude answer' })).toHaveLength(1);
    await waitFor(() => {
      expect(calls.map((c) => c.question)).toEqual([QUESTION, 'And after a restart?']);
    });
  });

  it('F-08.7 Ask Claude on a callout focuses the Ask box with the note’s line: "step 4 · L49"', async () => {
    const { client, calls } = await backend();
    await openDetailed(client);
    // Step 4 opens on note 2, at line 49.
    const note = await screen.findByRole('region', { name: 'Claude note at this line' });
    await userEvent.click(within(note).getByRole('button', { name: 'Ask Claude' }));

    await waitFor(() => {
      expect(askBox()).toHaveFocus();
    });
    await expectContext('step 4 · L49');
    // The box waits for the question; no empty card opens.
    expect(guide().queryByRole('article', { name: 'Claude answer' })).toBeNull();

    await userEvent.keyboard('Is the count refreshed by the worker?');
    await ctrlEnter();
    const card = await guide().findByRole('article', { name: 'Claude answer' });
    expect(await within(card).findByText(ANSWER)).toBeInTheDocument();
    expect(calls).toEqual([
      {
        step: 's4',
        question: 'Is the count refreshed by the worker?',
        selection: { file: VM, side: 'new', start: 49, end: 49 },
      },
    ]);
  });

  it('F-08.7 A focuses the Ask box on the step: "step 4"', async () => {
    await openDetailed((await backend()).client);
    await guide().findByRole('textbox', { name: ASK });
    await userEvent.keyboard('a');
    await waitFor(() => {
      expect(askBox()).toHaveFocus();
    });
    // The key focuses; it doesn't type.
    expect(askBox()).toHaveValue('');
    await expectContext('step 4');
  });

  it('F-08.7 lines selected in Focus mode come along: the context reads "step 4 · L47–L50" and the question is about them', async () => {
    const { client, calls } = await backend();
    const app = renderApp({ screen: 'S-03', sessionId: SESSION }, client);
    await app.router.navigate(`${pathFor({ screen: 'S-03', sessionId: SESSION })}?step=s4`);
    expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
    await waitFor(() => {
      addLine(47);
    });
    await userEvent.click(addLine(47));
    await userEvent.keyboard('{Shift>}');
    await userEvent.click(addLine(50));
    await userEvent.keyboard('{/Shift}');
    const selected = screen.getByRole('group', { name: 'Selected lines' });
    await userEvent.click(within(selected).getByRole('button', { name: 'Ask Claude' }));

    // Detailed on the same step (F-08.1).
    await userEvent.keyboard('{Control>}d{/Control}');
    await screen.findByRole('complementary', { name: 'Guide' });
    await expectContext('step 4 · L47–L50');

    await userEvent.click(askBox());
    await userEvent.keyboard('Why is the worker kicked here?');
    await ctrlEnter();
    await waitFor(() => {
      expect(calls).toEqual([
        {
          step: 's4',
          question: 'Why is the worker kicked here?',
          selection: { file: VM, side: 'new', start: 47, end: 50 },
        },
      ]);
    });
  });
});
