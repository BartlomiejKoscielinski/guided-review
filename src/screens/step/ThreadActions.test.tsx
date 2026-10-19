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
import { recordingClient } from '../../test/renderApp';
import { StepScreen } from './StepScreen';

// F-11.2 on S-03 (Review.dc.html thread card; M5 decisions 1 and 2): an open thread card has
// Resolve (green) and Reply under its notes; a resolved one has the "Resolved" tag and Reopen.
// Resolve, Reopen and Reply go to GitLab at once, one click each, and are not drafts. A failed
// call keeps the card as it was and the typed reply, and says why in one line.

const SESSION = 'mock-mr-session-1';
// !482's thread at _worker.Kick() (step 4, line 48) and the first one of step 2 (line 24).
const KICK = 'd-482-3';
const TABLE = 'd-482-1';
const FORBIDDEN = "GitLab doesn't allow this for your account.";
const REPLY_BOX = 'Write a reply…';
const CTRL_ENTER = '{Control>}{Enter}{/Control}';

function backend(): IpcClient {
  return { ...createMockClient({ latencyMs: 0, review: { planCached: true } }) };
}

function renderStep(ipc: IpcClient, step: string) {
  const router = createMemoryRouter(
    [{ path: '/session/:sessionId/step', element: <StepScreen /> }],
    { initialEntries: [`/session/${SESSION}/step?step=${step}`] },
  );
  render(
    <IpcProvider client={ipc}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </IpcProvider>,
  );
}

/** The card of the thread at `line`, once the step has loaded. */
const cardAt = (line: number) =>
  screen.findByRole('region', { name: `Thread at line ${String(line)}` });
/** The card at line 48 now: looked up again after each change, never kept across a refetch. */
const thread = () => screen.getByRole('region', { name: 'Thread at line 48' });
/** A button by its exact name, in `scope` (a card) or anywhere on the screen. */
const button = (name: string, scope?: HTMLElement) =>
  (scope ? within(scope) : screen).getByRole('button', { name });

const forbidden = () =>
  new IpcError({ code: 'GITLAB_FORBIDDEN', message: FORBIDDEN, retryable: false });

/** A promise the test settles by hand, to hold a call in flight. */
function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** Types a reply into the composer and sends it with Ctrl+Enter. */
async function sendReply(text: string) {
  await userEvent.type(await screen.findByPlaceholderText(REPLY_BOX), text);
  await userEvent.keyboard(CTRL_ENTER);
}

describe('S-03 thread actions (F-11.2)', () => {
  beforeEach(() => {
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-11.2 an open thread card has Resolve and Reply under its notes, no Resolved tag, no Reopen', async () => {
    renderStep(backend(), 's4');
    await cardAt(48);
    const resolve = button('Resolve', thread());
    expect(resolve).toBeEnabled();
    expect(button('Reply', thread())).toBeEnabled();
    expect(within(thread()).queryByText('Resolved')).toBeNull();
    expect(within(thread()).queryByRole('button', { name: 'Reopen' })).toBeNull();
    // Under the replies: the buttons follow the last note.
    const semaphore = within(thread()).getByText(
      'Kick only releases a semaphore, the upload runs in the background.',
    );
    expect(
      semaphore.compareDocumentPosition(resolve) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('F-11.2 Resolve resolves the thread at once: Resolved tag and Reopen replace Resolve and Reply', async () => {
    const ipc = backend();
    const resolveCall = vi.spyOn(ipc, 'gitlabResolve');
    renderStep(ipc, 's4');
    await cardAt(48);
    await userEvent.click(button('Resolve', thread()));

    const reopen = await within(thread()).findByRole('button', { name: 'Reopen' });
    expect(resolveCall).toHaveBeenCalledTimes(1);
    expect(resolveCall).toHaveBeenCalledWith(SESSION, KICK, true);
    expect(within(thread()).getByText('Resolved')).toBeInTheDocument();
    expect(within(thread()).queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(within(thread()).queryByRole('button', { name: 'Reply' })).toBeNull();
    // The notes stay, and the gutter icon says the thread is resolved.
    expect(thread()).toHaveTextContent('Kick() is called on the UI thread.');
    expect(
      await screen.findByRole('button', { name: 'Thread by Paweł S. at line 48, resolved' }),
    ).toBeInTheDocument();
    // The button that was pressed is gone: the keyboard focus moves to its successor.
    await waitFor(() => {
      expect(button('Reopen', thread())).toHaveFocus();
    });
    expect(reopen).toBeInTheDocument();
  });

  it('F-11.2 Reopen opens a resolved thread again: Resolve and Reply are back, the Resolved tag is gone', async () => {
    const ipc = backend();
    const resolveCall = vi.spyOn(ipc, 'gitlabResolve');
    renderStep(ipc, 's4');
    await cardAt(48);
    await userEvent.click(button('Resolve', thread()));
    await userEvent.click(await within(thread()).findByRole('button', { name: 'Reopen' }));

    await within(thread()).findByRole('button', { name: 'Resolve' });
    expect(resolveCall).toHaveBeenCalledTimes(2);
    expect(resolveCall).toHaveBeenLastCalledWith(SESSION, KICK, false);
    expect(button('Reply', thread())).toBeInTheDocument();
    expect(within(thread()).queryByText('Resolved')).toBeNull();
    expect(within(thread()).queryByRole('button', { name: 'Reopen' })).toBeNull();
    expect(
      await screen.findByRole('button', { name: 'Thread by Paweł S. at line 48' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(button('Resolve', thread())).toHaveFocus();
    });
  });

  it('F-11.2 while Resolve is in flight its button is disabled and the card does not claim Resolved yet', async () => {
    const ipc = backend();
    const real = ipc.gitlabResolve.bind(ipc);
    const held = gate();
    const resolveCall = vi.spyOn(ipc, 'gitlabResolve').mockImplementationOnce(async (...args) => {
      await held.opened;
      return real(...args);
    });
    renderStep(ipc, 's4');
    await cardAt(48);
    await userEvent.click(button('Resolve', thread()));

    await waitFor(() => {
      expect(button('Resolve', thread())).toBeDisabled();
    });
    expect(within(thread()).queryByText('Resolved')).toBeNull();
    await userEvent.click(button('Resolve', thread()));
    expect(resolveCall).toHaveBeenCalledTimes(1);

    held.open();
    expect(await within(thread()).findByText('Resolved')).toBeInTheDocument();
    expect(resolveCall).toHaveBeenCalledTimes(1);
  });

  it('F-11.2 a failed Resolve keeps the card open and says "Couldn\'t resolve the thread. <reason>"; trying again works', async () => {
    const ipc = backend();
    vi.spyOn(ipc, 'gitlabResolve').mockRejectedValueOnce(forbidden());
    renderStep(ipc, 's4');
    await cardAt(48);
    await userEvent.click(button('Resolve', thread()));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`Couldn't resolve the thread. ${FORBIDDEN}`);
    // Where the user acted: the line is in the card, under its buttons.
    expect(thread()).toContainElement(alert);
    expect(within(thread()).queryByText('Resolved')).toBeNull();
    expect(button('Resolve', thread())).toBeEnabled();
    expect(button('Reply', thread())).toBeEnabled();

    await userEvent.click(button('Resolve', thread()));
    expect(await within(thread()).findByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('F-11.2 a failed Reopen keeps the thread resolved and says "Couldn\'t reopen the thread. <reason>"', async () => {
    const ipc = backend();
    renderStep(ipc, 's4');
    await cardAt(48);
    await userEvent.click(button('Resolve', thread()));
    const reopen = await within(thread()).findByRole('button', { name: 'Reopen' });

    vi.spyOn(ipc, 'gitlabResolve').mockRejectedValueOnce(forbidden());
    await userEvent.click(reopen);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`Couldn't reopen the thread. ${FORBIDDEN}`);
    expect(thread()).toContainElement(alert);
    expect(within(thread()).getByText('Resolved')).toBeInTheDocument();
    expect(button('Reopen', thread())).toBeEnabled();
    expect(within(thread()).queryByRole('button', { name: 'Resolve' })).toBeNull();
  });

  it('F-11.2 each card acts on its own thread: Resolve at line 24 sends the discussion of that line', async () => {
    const ipc = backend();
    const resolveCall = vi.spyOn(ipc, 'gitlabResolve');
    renderStep(ipc, 's2');
    const first = await cardAt(24);
    await userEvent.click(button('Resolve', first));

    const again = await cardAt(24);
    expect(await within(again).findByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(resolveCall).toHaveBeenCalledTimes(1);
    expect(resolveCall).toHaveBeenCalledWith(SESSION, TABLE, true);
  });

  it('F-11.2 Reply opens a composer under the thread: text area "Write a reply…" in focus, Reply (disabled while blank) and Cancel', async () => {
    renderStep(backend(), 's4');
    await cardAt(48);
    await userEvent.click(button('Reply', thread()));

    const text = await screen.findByPlaceholderText(REPLY_BOX);
    expect(text).toHaveAccessibleName('Reply');
    await waitFor(() => {
      expect(text).toHaveFocus();
    });
    // The composer's Reply is the only button of that name while it is open.
    const send = button('Reply');
    expect(send).toBeDisabled();
    expect(button('Cancel')).toBeEnabled();
    // The composer sits under the thread's notes; Resolve stays available.
    const semaphore = within(thread()).getByText(
      'Kick only releases a semaphore, the upload runs in the background.',
    );
    expect(semaphore.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button('Resolve', thread())).toBeEnabled();

    await userEvent.type(text, 'Thanks');
    expect(send).toBeEnabled();
  });

  it('F-11.2 Ctrl+Enter sends the reply at once: it appears under the notes as the signed-in user, it is not a draft', async () => {
    const ipc = backend();
    const replyCall = vi.spyOn(ipc, 'gitlabReply');
    const draftCall = vi.spyOn(ipc, 'draftsCreate');
    renderStep(ipc, 's4');
    await cardAt(48);
    await userEvent.click(button('Reply', thread()));
    await sendReply('Thanks, that answers it.');

    expect(await within(thread()).findByText('Thanks, that answers it.')).toBeInTheDocument();
    expect(replyCall).toHaveBeenCalledTimes(1);
    expect(replyCall).toHaveBeenCalledWith(SESSION, KICK, 'Thanks, that answers it.');
    expect(draftCall).not.toHaveBeenCalled();
    expect(await ipc.draftsList(SESSION)).toEqual([]);
    // The composer is gone; the thread has its own Reply back, in focus.
    expect(screen.queryByPlaceholderText(REPLY_BOX)).toBeNull();
    await waitFor(() => {
      expect(button('Reply', thread())).toHaveFocus();
    });
    // After Marta K.'s note, under the signed-in user's name, now, with the initials square.
    const text = thread().textContent;
    expect(text.indexOf('Thanks, that answers it.')).toBeGreaterThan(
      text.indexOf('Kick only releases a semaphore'),
    );
    expect(
      within(thread()).getByText('Bartek K.', { selector: 'b' }).parentElement,
    ).toHaveTextContent(/^Bartek K\. · just now$/);
    expect(within(thread()).getByText('BK')).toBeInTheDocument();
    // Replying is not resolving.
    expect(within(thread()).queryByText('Resolved')).toBeNull();
    expect(button('Resolve', thread())).toBeEnabled();
  });

  it('F-11.2 the Reply button sends the text; blank text sends nothing (button and Ctrl+Enter)', async () => {
    const ipc = backend();
    const replyCall = vi.spyOn(ipc, 'gitlabReply');
    renderStep(ipc, 's4');
    await cardAt(48);
    await userEvent.click(button('Reply', thread()));
    const text = await screen.findByPlaceholderText(REPLY_BOX);

    await userEvent.type(text, '   ');
    await userEvent.keyboard(CTRL_ENTER);
    expect(button('Reply')).toBeDisabled();
    expect(replyCall).not.toHaveBeenCalled();

    await userEvent.clear(text);
    await userEvent.type(text, 'Fine by me.');
    await userEvent.click(button('Reply'));
    expect(await within(thread()).findByText('Fine by me.')).toBeInTheDocument();
    expect(replyCall).toHaveBeenCalledTimes(1);
    expect(replyCall).toHaveBeenCalledWith(SESSION, KICK, 'Fine by me.');
  });

  it('F-11.2 Esc and Cancel close the composer, send nothing and drop the text', async () => {
    const ipc = backend();
    const replyCall = vi.spyOn(ipc, 'gitlabReply');
    renderStep(ipc, 's4');
    await cardAt(48);

    await userEvent.click(button('Reply', thread()));
    await userEvent.type(await screen.findByPlaceholderText(REPLY_BOX), 'Never mind');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByPlaceholderText(REPLY_BOX)).toBeNull();
    await waitFor(() => {
      expect(button('Reply', thread())).toHaveFocus();
    });

    await userEvent.click(button('Reply', thread()));
    const again = await screen.findByPlaceholderText(REPLY_BOX);
    expect(again).toHaveValue('');
    await userEvent.type(again, 'Not this either');
    await userEvent.click(button('Cancel'));
    expect(screen.queryByPlaceholderText(REPLY_BOX)).toBeNull();
    await waitFor(() => {
      expect(button('Reply', thread())).toHaveFocus();
    });

    expect(replyCall).not.toHaveBeenCalled();
    expect(thread()).not.toHaveTextContent('Never mind');
    expect(thread()).not.toHaveTextContent('Not this either');
  });

  it('F-11.2 a failed reply keeps the composer and the text and says "Couldn\'t send the reply. <reason>"; sending again works', async () => {
    const ipc = backend();
    const replyCall = vi.spyOn(ipc, 'gitlabReply').mockRejectedValueOnce(forbidden());
    renderStep(ipc, 's4');
    await cardAt(48);
    await userEvent.click(button('Reply', thread()));
    const text = await screen.findByPlaceholderText(REPLY_BOX);
    await sendReply('Please look again');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`Couldn't send the reply. ${FORBIDDEN}`);
    expect(text).toBeInTheDocument();
    expect(text).toHaveValue('Please look again');
    expect(button('Reply')).toBeEnabled();
    expect(thread()).not.toHaveTextContent('Bartek K.');

    await userEvent.click(button('Reply'));
    expect(await within(thread()).findByText('Please look again')).toBeInTheDocument();
    expect(replyCall).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByPlaceholderText(REPLY_BOX)).toBeNull();
  });

  it('F-11.2 while a reply is in flight the Reply button is disabled, the text stays and a second Ctrl+Enter sends nothing', async () => {
    const ipc = backend();
    const real = ipc.gitlabReply.bind(ipc);
    const held = gate();
    const replyCall = vi.spyOn(ipc, 'gitlabReply').mockImplementationOnce(async (...args) => {
      await held.opened;
      return real(...args);
    });
    renderStep(ipc, 's4');
    await cardAt(48);
    await userEvent.click(button('Reply', thread()));
    const text = await screen.findByPlaceholderText(REPLY_BOX);
    await sendReply('One only');

    await waitFor(() => {
      expect(button('Reply')).toBeDisabled();
    });
    expect(text).toHaveValue('One only');
    // Not shown as sent before GitLab has it.
    expect(thread()).not.toHaveTextContent('Bartek K.');
    await userEvent.keyboard(CTRL_ENTER);
    expect(replyCall).toHaveBeenCalledTimes(1);

    held.open();
    expect(await within(thread()).findByText('One only')).toBeInTheDocument();
    expect(replyCall).toHaveBeenCalledTimes(1);
  });

  it('F-11.2 Resolve and Reply are independent of the drafts: they touch no draft and start no Claude work', async () => {
    const base = backend();
    const draft = await base.draftsCreate({
      sessionId: SESSION,
      findingId: null,
      body: 'A draft that stays a draft.',
      position: {
        file: 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs',
        side: 'new',
        line: 46,
      },
      severity: null,
    });
    const { client, calls } = recordingClient(base);
    renderStep(client, 's4');
    await cardAt(48);
    // What the screen loads on its own is behind us before the actions start.
    await waitFor(() => {
      expect(calls).toContain('reviewFindings');
    });
    const before = calls.length;

    await userEvent.click(button('Resolve', thread()));
    await userEvent.click(await within(thread()).findByRole('button', { name: 'Reopen' }));
    await userEvent.click(await within(thread()).findByRole('button', { name: 'Reply' }));
    await sendReply('Done.');
    expect(await within(thread()).findByText('Done.')).toBeInTheDocument();

    const after = calls.slice(before);
    expect(after).toContain('gitlabResolve');
    expect(after).toContain('gitlabReply');
    const forbiddenCalls =
      /^(drafts(Create|Update|Delete)|claude|reviewFindings|reviewAsk|reviewDecide)/;
    expect(after.filter((name) => forbiddenCalls.test(name))).toEqual([]);
    expect(await base.draftsList(SESSION)).toEqual([draft]);
  });
});
