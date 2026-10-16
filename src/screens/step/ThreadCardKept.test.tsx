import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '../../app/queryClient';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { IpcProvider } from '../../ipc/IpcProvider';
import { createMockClient } from '../../ipc/mock';
import { StepScreen } from './StepScreen';

// F-11.2, M5 decision 2 ("nothing typed is lost", "the error shows where the user acted"): a
// thread card's composer, its text, a call in flight and the last error outlive the card. The
// diff's virtual list unmounts a card once it scrolls out of view; closing the card with its
// gutter icon unmounts it the same way, so these tests close and open it again.

const SESSION = 'mock-mr-session-1';
const REPLY_BOX = 'Write a reply…';
const CTRL_ENTER = '{Control>}{Enter}{/Control}';
const FORBIDDEN = "GitLab doesn't allow this for your account.";

function backend(): IpcClient {
  return { ...createMockClient({ latencyMs: 0, review: { planCached: true } }) };
}

function renderStep(ipc: IpcClient) {
  const router = createMemoryRouter(
    [{ path: '/session/:sessionId/step', element: <StepScreen /> }],
    { initialEntries: [`/session/${SESSION}/step?step=s4`] },
  );
  render(
    <IpcProvider client={ipc}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </IpcProvider>,
  );
}

const thread = () => screen.getByRole('region', { name: 'Thread at line 48' });
const noThread = () => screen.queryByRole('region', { name: 'Thread at line 48' });
const button = (name: string, scope?: HTMLElement) =>
  (scope ? within(scope) : screen).getByRole('button', { name });
/** The gutter icon of the thread at line 48, open or resolved. */
const icon = () => screen.getByRole('button', { name: /^Thread by Paweł S\. at line 48/ });

/** Closes the card with its gutter icon (it unmounts) and opens it again. */
async function closeCard() {
  await userEvent.click(icon());
  expect(noThread()).toBeNull();
}
async function openCard() {
  await userEvent.click(icon());
  return screen.findByRole('region', { name: 'Thread at line 48' });
}

/** A promise the test settles by hand, to hold a call in flight. */
function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

async function startReply(text: string) {
  await screen.findByRole('region', { name: 'Thread at line 48' });
  await userEvent.click(button('Reply', thread()));
  await userEvent.type(await screen.findByPlaceholderText(REPLY_BOX), text);
}

describe('S-03 thread card state outlives the card (F-11.2)', () => {
  beforeEach(() => {
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-11.2 a reply being typed is still there when its card comes back, and the composer does not take the focus', async () => {
    renderStep(backend());
    await startReply('Half a thought');
    await closeCard();
    const card = await openCard();

    const text = within(card).getByPlaceholderText(REPLY_BOX);
    expect(text).toHaveValue('Half a thought');
    // Still composing: the thread's own Reply stays hidden, the composer's Reply sends.
    expect(within(card).getAllByRole('button', { name: 'Reply' })).toHaveLength(1);
    expect(button('Reply', card)).toHaveAttribute('type', 'submit');
    // The text is the field's value only, never shown as page text before GitLab has it.
    expect(card).not.toHaveTextContent('Half a thought');
    // Coming back into view is not an invitation to type: the focus stays where the reader is.
    expect(icon()).toHaveFocus();

    // Cancel still drops it.
    await userEvent.click(button('Cancel', card));
    await closeCard();
    await openCard();
    expect(screen.queryByPlaceholderText(REPLY_BOX)).toBeNull();
  });

  it('F-11.2 a reply that fails while its card is out of view shows its error and keeps the text when the card is back', async () => {
    const ipc = backend();
    const held = gate();
    vi.spyOn(ipc, 'gitlabReply').mockImplementationOnce(async () => {
      await held.opened;
      throw new IpcError({ code: 'GITLAB_FORBIDDEN', message: FORBIDDEN, retryable: false });
    });
    renderStep(ipc);
    await startReply('Please look again');
    await userEvent.keyboard(CTRL_ENTER);
    await closeCard();
    held.open();
    // The call settles while nothing shows the card.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const card = await openCard();

    expect(await within(card).findByRole('alert')).toHaveTextContent(
      `Couldn't send the reply. ${FORBIDDEN}`,
    );
    expect(within(card).getByPlaceholderText(REPLY_BOX)).toHaveValue('Please look again');
    expect(button('Reply', card)).toBeEnabled();
  });

  it('F-11.2 a reply in flight stays busy while its card is away; once GitLab has it, the card shows it and the composer is closed', async () => {
    const ipc = backend();
    const real = ipc.gitlabReply.bind(ipc);
    const held = gate();
    const replyCall = vi.spyOn(ipc, 'gitlabReply').mockImplementationOnce(async (...args) => {
      await held.opened;
      return real(...args);
    });
    renderStep(ipc);
    await startReply('One only');
    await userEvent.keyboard(CTRL_ENTER);
    await closeCard();
    let card = await openCard();

    // Back while the call is on its way: still busy, so it cannot be sent twice.
    expect(within(card).getByPlaceholderText(REPLY_BOX)).toHaveValue('One only');
    expect(button('Reply', card)).toBeDisabled();
    await userEvent.click(within(card).getByPlaceholderText(REPLY_BOX));
    await userEvent.keyboard(CTRL_ENTER);
    expect(replyCall).toHaveBeenCalledTimes(1);

    await closeCard();
    held.open();
    await new Promise((resolve) => setTimeout(resolve, 20));
    card = await openCard();
    expect(await within(card).findByText('One only')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(REPLY_BOX)).toBeNull();
    expect(button('Reply', card)).toBeEnabled();
    expect(replyCall).toHaveBeenCalledTimes(1);
  });

  it('F-11.2 Resolve while a reply is being written keeps the composer and its text; Cancel closes it, Reopen brings Reply back', async () => {
    const ipc = backend();
    const replyCall = vi.spyOn(ipc, 'gitlabReply');
    renderStep(ipc);
    await startReply('Resolving, but one more thing');
    await userEvent.click(button('Resolve', thread()));

    await within(thread()).findByRole('button', { name: 'Reopen' });
    expect(within(thread()).getByText('Resolved')).toBeInTheDocument();
    expect(within(thread()).getByPlaceholderText(REPLY_BOX)).toHaveValue(
      'Resolving, but one more thing',
    );
    expect(replyCall).not.toHaveBeenCalled();

    // A reply on a resolved thread is still a reply (GitLab takes it); the composer sends it.
    await userEvent.click(button('Cancel', thread()));
    expect(screen.queryByPlaceholderText(REPLY_BOX)).toBeNull();
    // Resolved and not composing: the tag and Reopen, which takes the focus.
    expect(within(thread()).queryByRole('button', { name: 'Reply' })).toBeNull();
    await waitFor(() => {
      expect(button('Reopen', thread())).toHaveFocus();
    });

    await userEvent.click(button('Reopen', thread()));
    expect(await within(thread()).findByRole('button', { name: 'Reply' })).toBeEnabled();
    expect(screen.queryByPlaceholderText(REPLY_BOX)).toBeNull();
    expect(replyCall).not.toHaveBeenCalled();
  });

  it('F-11.2 a reply sent on a thread resolved meanwhile is posted and the focus goes to Reopen', async () => {
    const ipc = backend();
    const replyCall = vi.spyOn(ipc, 'gitlabReply');
    renderStep(ipc);
    await startReply('Thanks, resolving.');
    await userEvent.click(button('Resolve', thread()));
    await within(thread()).findByRole('button', { name: 'Reopen' });

    await userEvent.click(within(thread()).getByPlaceholderText(REPLY_BOX));
    await userEvent.keyboard(CTRL_ENTER);
    expect(await within(thread()).findByText('Thanks, resolving.')).toBeInTheDocument();
    expect(replyCall).toHaveBeenCalledTimes(1);
    expect(screen.queryByPlaceholderText(REPLY_BOX)).toBeNull();
    expect(within(thread()).getByText('Resolved')).toBeInTheDocument();
    await waitFor(() => {
      expect(button('Reopen', thread())).toHaveFocus();
    });
  });
});
