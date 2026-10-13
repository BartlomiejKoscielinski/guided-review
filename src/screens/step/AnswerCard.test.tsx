import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { ANSWER_PARTS, NOTES_STEP } from '../../ipc/mock/fixtures/review';
import type { AskAnswer } from '../../ipc/types/AskAnswer';
import type { ClaudeTaskEvent } from '../../ipc/types/ClaudeTaskEvent';
import type { LineSelection } from '../../ipc/types/LineSelection';
import { mockClient, renderWithIpc } from '../../test/render';
import { AnswerCard } from './AnswerCard';

const SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const SELECTION: LineSelection = { file: VM, side: 'new', start: 46, end: 49 };
const ANSWER = ANSWER_PARTS.join('').trim();

/** `reviewAsk` the test drives: pieces and the end come from the test. */
function controlledAsk() {
  const state: {
    calls: { question: string; selection: LineSelection | null }[];
    emit: (event: ClaudeTaskEvent<AskAnswer>) => void;
    resolve: (answer: AskAnswer) => void;
  } = { calls: [], emit: () => undefined, resolve: () => undefined };
  const reviewAsk: IpcClient['reviewAsk'] = (_s, _step, question, selection, onEvent) => {
    state.calls.push({ question, selection });
    state.emit = onEvent;
    return new Promise<AskAnswer>((resolve) => {
      state.resolve = resolve;
    });
  };
  return { state, reviewAsk };
}

async function ask(question: string) {
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Ask Claude about this step' }),
    question,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Ask Claude' }));
}

describe('AnswerCard', () => {
  it('F-10.2 the answer streams in piece by piece, then Add to drafts and Copy appear', async () => {
    const { state, reviewAsk } = controlledAsk();
    renderWithIpc(<AnswerCard sessionId={SESSION} stepId={NOTES_STEP} selection={null} />, {
      reviewAsk,
    });
    await ask('Why a queue here?');
    const card = screen.getByRole('article', { name: 'Claude answer' });
    expect(within(card).getByText('Why a queue here?')).toBeInTheDocument();
    act(() => {
      state.emit({ kind: 'queued' });
      state.emit({ kind: 'started' });
    });
    expect(within(card).getByText('Claude is reading this step…')).toBeInTheDocument();

    act(() => {
      state.emit({ kind: 'partialText', text: ANSWER_PARTS[0] ?? '' });
    });
    expect(within(card).getByText(ANSWER_PARTS[0]?.trim() ?? '')).toBeInTheDocument();
    act(() => {
      state.emit({ kind: 'partialText', text: ANSWER_PARTS[1] ?? '' });
    });
    expect(
      within(card).getByText(`${ANSWER_PARTS[0] ?? ''}${ANSWER_PARTS[1] ?? ''}`.trim()),
    ).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Add to drafts' })).not.toBeInTheDocument();

    const result: AskAnswer = { text: ANSWER, followUp: false };
    await act(async () => {
      state.emit({ kind: 'done', result });
      state.resolve(result);
      await Promise.resolve();
    });
    expect(within(card).getByText(ANSWER)).toBeInTheDocument();
    expect(await within(card).findByRole('button', { name: 'Add to drafts' })).toBeEnabled();
    expect(within(card).getByRole('button', { name: 'Copy' })).toBeEnabled();
  });

  it('F-10.1 F-10.2 the question goes with the selection; a follow-up asks again on the step', async () => {
    const { state, reviewAsk } = controlledAsk();
    renderWithIpc(<AnswerCard sessionId={SESSION} stepId={NOTES_STEP} selection={SELECTION} />, {
      reviewAsk,
    });
    await ask('Why a queue here?');
    const result: AskAnswer = { text: ANSWER, followUp: false };
    await act(async () => {
      state.emit({ kind: 'done', result });
      state.resolve(result);
      await Promise.resolve();
    });
    await ask('And offline?');
    expect(state.calls).toEqual([
      { question: 'Why a queue here?', selection: SELECTION },
      { question: 'And offline?', selection: SELECTION },
    ]);
    expect(screen.getByText('And offline?')).toBeInTheDocument();
  });

  it('F-10.3 Add to drafts makes a draft of the answer on the selection’s last line', async () => {
    const ipc = mockClient();
    renderWithIpc(
      <AnswerCard sessionId={SESSION} stepId={NOTES_STEP} selection={SELECTION} />,
      ipc,
    );
    await ask('Why a queue here?');
    await userEvent.click(await screen.findByRole('button', { name: 'Add to drafts' }));
    expect(
      await screen.findByText('Added to drafts. It reaches GitLab only when you publish.'),
    ).toBeInTheDocument();
    expect(await ipc.draftsList(SESSION)).toMatchObject([
      {
        findingId: null,
        body: ANSWER,
        position: { file: VM, side: 'new', line: 49 },
        severity: null,
      },
    ]);
  });

  it('F-10.3 without a selection the draft is a comment on the merge request', async () => {
    const ipc = mockClient();
    renderWithIpc(<AnswerCard sessionId={SESSION} stepId={NOTES_STEP} selection={null} />, ipc);
    await ask('What does this step do?');
    await userEvent.click(await screen.findByRole('button', { name: 'Add to drafts' }));
    await screen.findByText(/Added to drafts/);
    const [draft] = await ipc.draftsList(SESSION);
    expect(draft?.position).toBeNull();
  });

  it('F-10.1 opened from Ask Claude with the input focused; an empty question cannot be sent', () => {
    renderWithIpc(
      <AnswerCard sessionId={SESSION} stepId={NOTES_STEP} selection={null} autoFocus />,
    );
    expect(screen.getByRole('textbox', { name: 'Ask Claude about this step' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Ask Claude' })).toBeDisabled();
  });
});
