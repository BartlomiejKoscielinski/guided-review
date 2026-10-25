import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { renderApp } from '../../test/renderApp';

// F-26.7: a question thread on S-10 (Author.dc.html `isQuestion`, M7 decisions 5 and 14). Its card
// is answered, not fixed: instead of the actions it holds the reply composer, at once (no Reply
// button to open it first):
//  - a text area named "Your reply" (placeholder "Write a reply…"),
//  - **Draft with Claude** -> claudeReplyDraft(project, iid, discussion) answers { reply }; the
//    text fills the area and nothing is sent; while it runs the button reads "Drafting…" and is
//    disabled, and so is Send reply,
//  - **Send reply** -> authorReply(project, iid, discussion, body) at once, the body as typed (no
//    queue, no push); disabled for an empty or blank text and while the reply goes out,
//  - the hint "Replies on your MR go out right away.".
// After sending the composer gives way to "Answered. The thread stays open until Piotr resolves
// it." (the reviewer's first name, no pronoun), my reply is the thread's last note ("You"), the
// list tag reads Answered and the heading counts one thread less. A question whose last note is
// mine already (opened later) reads the same sentence and has no composer. Nothing is drafted or
// sent by opening a thread. The text, the busy flag and the last error belong to the thread: they
// survive picking another thread and coming back.
// Against the mock backend's !480 (Piotr S. UploadWorker.cs:36 is the question).
//
// Locators the screen keeps: the card is <section role="region" aria-label="Thread">; in it the
// textbox "Your reply", the buttons "Draft with Claude" (or "Drafting…") and "Send reply", the
// sentence as one text element, errors as role="alert".

const PROJECT = 'mobile/mobile-app';
const IID = 480;
const QUESTION_ID = 'author-t2';
const PIOTR = 'What happens if the app is killed in the middle of retrying?';
const DRAFT =
  'The attempt count is kept in memory only, so a kill resets it. I will persist it with the queue item.';
const SENT_LINE = 'Answered. The thread stays open until Piotr resolves it.';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Draft = IpcClient['claudeReplyDraft'];
type Send = IpcClient['authorReply'];
type AuthorMr = Awaited<ReturnType<IpcClient['authorMr']>>;
type Thread = AuthorMr['threads'][number];

/** The mock's !480; `draft` and `send` replace the two new commands, `threads` the list. */
async function backend(
  over: {
    draft?: Draft;
    /** Wraps the mock's own `authorReply`, so the mock's MR still learns of a reply that went out. */
    send?: (real: Send) => Send;
    threads?: (base: Thread[]) => Thread[];
  } = {},
) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const claudeReplyDraft = vi.fn<Draft>(over.draft ?? (() => Promise.resolve({ reply: DRAFT })));
  const real = base.authorReply.bind(base);
  const authorReply = vi.fn<Send>(over.send ? over.send(real) : real);
  const authorQueueReply = vi.fn<IpcClient['authorQueueReply']>(base.authorQueueReply);
  const authorPushAndReply = vi.fn<IpcClient['authorPushAndReply']>(base.authorPushAndReply);
  const client: Partial<IpcClient> = { ...base, claudeReplyDraft, authorReply };
  client.authorQueueReply = authorQueueReply;
  client.authorPushAndReply = authorPushAndReply;
  if (over.threads) {
    const threadsOf = over.threads;
    client.authorMr = async (project, iid) => {
      const mr = await base.authorMr(project, iid);
      return { ...mr, threads: threadsOf(mr.threads) };
    };
  }
  return { client, claudeReplyDraft, authorReply, authorQueueReply, authorPushAndReply };
}

async function openAuthor(over?: Parameters<typeof backend>[0]) {
  const rec = await backend(over);
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: IID })));
  return { ...app, ...rec };
}

const card = () => screen.findByRole('region', { name: 'Thread' });
const option = (name: RegExp) => {
  const found = within(screen.getByRole('listbox', { name: 'Threads' }))
    .getAllByRole('option')
    .find((o) => name.test(o.textContent));
  if (!found) throw new Error(`no thread option ${String(name)}`);
  return found;
};

/** Opens Piotr's question and returns its card. */
async function openQuestion() {
  await card();
  await userEvent.click(option(/Piotr S\./));
  await screen.findByRole('button', { name: 'Open in Rider · line 36' });
  const region = within(await card());
  await region.findByText(new RegExp(PIOTR));
  return region;
}

const box = () => within(screen.getByRole('region', { name: 'Thread' })).getByRole('textbox');
const named = (name: string | RegExp) =>
  within(screen.getByRole('region', { name: 'Thread' })).getByRole('button', { name });
const heading = () => screen.getByRole('heading', { level: 1 });

const unreachable = () =>
  new IpcError({
    code: 'GITLAB_UNREACHABLE',
    message: "GitLab isn't reachable.",
    retryable: true,
  });

/** The first send fails, the next ones go to the mock. */
const failOnce = (real: Send): Send => {
  let failed = false;
  return (...args) => {
    if (failed) return real(...args);
    failed = true;
    return Promise.reject(unreachable());
  };
};

/** The call `index` (0-based) of a spy; fails loudly when it was not made. */
const callOf = (spy: { mock: { calls: readonly unknown[][] } }, index: number) => {
  const call = spy.mock.calls[index];
  if (!call) throw new Error(`call ${String(index)} was not made`);
  return call;
};

describe('S-10 question thread: reply composer (F-26.7)', () => {
  beforeEach(() => {
    // jsdom lays nothing out; give elements a size so a virtual list renders its rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('F-26.7 a question thread opens with the reply text area, Draft with Claude and Send reply, and no Reply button', async () => {
    await openAuthor();
    const thread = await openQuestion();

    const area = thread.getByRole('textbox', { name: 'Your reply' });
    expect(area).toHaveAttribute('placeholder', 'Write a reply…');
    expect(area).toHaveValue('');
    expect(thread.getByRole('button', { name: 'Draft with Claude' })).toBeEnabled();
    expect(thread.getByRole('button', { name: 'Send reply' })).toBeDisabled();
    expect(thread.getByText('Replies on your MR go out right away.')).toBeInTheDocument();
    // The composer is the answer: no Reply button to open it, no Fix actions.
    expect(thread.queryByRole('button', { name: 'Reply' })).toBeNull();
    expect(thread.queryByRole('button', { name: 'Fix with Claude' })).toBeNull();
    expect(thread.queryByRole('button', { name: 'Fix in Rider' })).toBeNull();
  });

  it('F-26.7 a change thread has no composer: it keeps Reply next to the fix actions', async () => {
    await openAuthor();

    const thread = within(await card());
    expect(thread.getByRole('button', { name: 'Reply' })).toBeEnabled();
    expect(thread.getByRole('button', { name: 'Fix with Claude' })).toBeEnabled();
    expect(thread.queryByRole('textbox', { name: 'Your reply' })).toBeNull();
    expect(thread.queryByRole('button', { name: 'Draft with Claude' })).toBeNull();
    expect(thread.queryByRole('button', { name: 'Send reply' })).toBeNull();
  });

  it('F-26.7 a question on the MR itself (no file) has the composer too', async () => {
    const { claudeReplyDraft } = await openAuthor({
      threads: (all) => {
        const [first, second] = all;
        if (!first || !second) throw new Error('the mock has two threads');
        return [first, { ...second, place: 'General', path: null, line: null }];
      },
    });
    await card();
    await userEvent.click(option(/Piotr S\./));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Your reply' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /^Open in Rider/ })).toBeNull();
    await userEvent.click(named('Draft with Claude'));
    await waitFor(() => {
      expect(box()).toHaveValue(DRAFT);
    });
    expect(callOf(claudeReplyDraft, 0)).toEqual([PROJECT, IID, QUESTION_ID]);
  });

  it('F-26.7 opening the thread and typing draft nothing and send nothing', async () => {
    const { claudeReplyDraft, authorReply, authorQueueReply, authorPushAndReply } =
      await openAuthor();
    await openQuestion();

    await userEvent.type(box(), 'Not yet.');

    expect(claudeReplyDraft).not.toHaveBeenCalled();
    expect(authorReply).not.toHaveBeenCalled();
    expect(authorQueueReply).not.toHaveBeenCalled();
    expect(authorPushAndReply).not.toHaveBeenCalled();
  });

  it('F-26.7 Draft with Claude asks for this thread and fills the text area without sending it', async () => {
    const { claudeReplyDraft, authorReply } = await openAuthor();
    await openQuestion();

    await userEvent.click(named('Draft with Claude'));

    await waitFor(() => {
      expect(box()).toHaveValue(DRAFT);
    });
    expect(claudeReplyDraft).toHaveBeenCalledTimes(1);
    expect(callOf(claudeReplyDraft, 0)).toEqual([PROJECT, IID, QUESTION_ID]);
    expect(authorReply).not.toHaveBeenCalled();
    // Still a question to answer, until the author clicks Send reply.
    expect(within(option(/Piotr S\./)).getByText('Question')).toBeInTheDocument();
    expect(heading()).toHaveTextContent('2 threads to answer');
    expect(named('Send reply')).toBeEnabled();
    expect(named('Draft with Claude')).toBeEnabled();
  });

  it('F-26.7 while Claude drafts the button reads Drafting… and is disabled, and so is Send reply', async () => {
    const run = deferred<{ reply: string }>();
    const { claudeReplyDraft } = await openAuthor({ draft: () => run.promise });
    await openQuestion();
    await userEvent.type(box(), 'Half a thought');

    await userEvent.click(named('Draft with Claude'));

    expect(await within(await card()).findByRole('button', { name: 'Drafting…' })).toBeDisabled();
    expect(named('Send reply')).toBeDisabled();
    expect(
      within(screen.getByRole('region', { name: 'Thread' })).queryByRole('button', {
        name: 'Draft with Claude',
      }),
    ).toBeNull();
    // One run only, even when the click is repeated.
    await userEvent.click(named('Drafting…'));
    expect(claudeReplyDraft).toHaveBeenCalledTimes(1);

    run.resolve({ reply: DRAFT });
    await waitFor(() => {
      expect(box()).toHaveValue(DRAFT);
    });
    expect(named('Draft with Claude')).toBeEnabled();
    expect(named('Send reply')).toBeEnabled();
  });

  it('F-26.7 a failed draft says so, keeps what was typed and offers Draft with Claude again', async () => {
    const draft = vi
      .fn<Draft>()
      .mockRejectedValueOnce(
        new IpcError({
          code: 'CLAUDE_FAILED',
          message: 'Claude could not draft a reply.',
          retryable: true,
        }),
      )
      .mockResolvedValueOnce({ reply: DRAFT });
    await openAuthor({ draft });
    await openQuestion();
    await userEvent.type(box(), 'My own start');

    await userEvent.click(named('Draft with Claude'));

    const alert = await within(await card()).findByRole('alert');
    expect(alert).toHaveTextContent('Claude could not draft a reply.');
    expect(box()).toHaveValue('My own start');
    expect(named('Draft with Claude')).toBeEnabled();
    expect(named('Send reply')).toBeEnabled();

    await userEvent.click(named('Draft with Claude'));
    await waitFor(() => {
      expect(box()).toHaveValue(DRAFT);
    });
    expect(within(screen.getByRole('region', { name: 'Thread' })).queryByRole('alert')).toBeNull();
  });

  it('F-26.7 a second draft replaces the text in the area, as the mock does', async () => {
    const draft = vi
      .fn<Draft>()
      .mockResolvedValueOnce({ reply: 'First proposal.' })
      .mockResolvedValueOnce({ reply: 'Second proposal.' });
    await openAuthor({ draft });
    await openQuestion();

    await userEvent.click(named('Draft with Claude'));
    await waitFor(() => {
      expect(box()).toHaveValue('First proposal.');
    });
    await userEvent.click(named('Draft with Claude'));
    await waitFor(() => {
      expect(box()).toHaveValue('Second proposal.');
    });
  });

  it('F-26.7 Send reply is disabled for an empty or blank text', async () => {
    const { authorReply } = await openAuthor();
    await openQuestion();

    expect(named('Send reply')).toBeDisabled();
    await userEvent.type(box(), '   ');
    expect(named('Send reply')).toBeDisabled();
    await userEvent.type(box(), 'Ok');
    expect(named('Send reply')).toBeEnabled();
    await userEvent.clear(box());
    expect(named('Send reply')).toBeDisabled();
    expect(authorReply).not.toHaveBeenCalled();
  });

  it('F-26.7 Send reply sends the edited text as typed at once, then the card says Answered and the thread leaves the to-answer count', async () => {
    const { authorReply, authorQueueReply, authorPushAndReply } = await openAuthor();
    await openQuestion();
    await userEvent.click(named('Draft with Claude'));
    await waitFor(() => {
      expect(box()).toHaveValue(DRAFT);
    });
    await userEvent.type(box(), ' Zażółć!');

    await userEvent.click(named('Send reply'));

    const thread = within(await card());
    expect(await thread.findByText(SENT_LINE)).toBeInTheDocument();
    expect(authorReply).toHaveBeenCalledTimes(1);
    expect(callOf(authorReply, 0)).toEqual([PROJECT, IID, QUESTION_ID, `${DRAFT} Zażółć!`]);
    // Immediate: nothing is queued and nothing is pushed.
    expect(authorQueueReply).not.toHaveBeenCalled();
    expect(authorPushAndReply).not.toHaveBeenCalled();
    // The composer is gone; my reply ends the conversation.
    expect(thread.queryByRole('textbox')).toBeNull();
    expect(thread.queryByRole('button', { name: 'Send reply' })).toBeNull();
    expect(thread.queryByRole('button', { name: 'Draft with Claude' })).toBeNull();
    expect(thread.queryByRole('button', { name: 'Reply' })).toBeNull();
    expect(thread.getByText('You')).toBeInTheDocument();
    expect(thread.getByText(`${DRAFT} Zażółć!`)).toBeInTheDocument();
    // The list: tag Answered, one thread left to answer.
    await waitFor(() => {
      expect(within(option(/Piotr S\./)).getByText('Answered')).toBeInTheDocument();
    });
    expect(within(option(/Piotr S\./)).queryByText('Question')).toBeNull();
    expect(heading()).toHaveTextContent('1 thread to answer');
  });

  it('F-26.7 the sentence names the reviewer by first name only', async () => {
    await openAuthor({
      threads: (all) => {
        const [first, second] = all;
        if (!first || !second) throw new Error('the mock has two threads');
        return [
          first,
          {
            ...second,
            author: 'Zofia Żak',
            notes: second.notes.map((n) => ({ ...n, author: 'Zofia Żak' })),
          },
        ];
      },
    });
    await card();
    await userEvent.click(option(/Zofia/));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Your reply' }), 'Thanks.');
    await userEvent.click(named('Send reply'));

    expect(
      await within(await card()).findByText(
        'Answered. The thread stays open until Zofia resolves it.',
      ),
    ).toBeInTheDocument();
  });

  it('F-26.7 while the reply goes out Send reply is disabled and one click sends one reply', async () => {
    const run = deferred<undefined>();
    const { authorReply } = await openAuthor({
      send:
        (real) =>
        async (...args) => {
          await run.promise;
          return real(...args);
        },
    });
    await openQuestion();
    await userEvent.type(box(), 'On it.');

    await userEvent.click(named('Send reply'));
    await waitFor(() => {
      expect(named('Send reply')).toBeDisabled();
    });
    await userEvent.click(named('Send reply'));
    expect(authorReply).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(SENT_LINE)).toBeNull();

    run.resolve(undefined);
    expect(await within(await card()).findByText(SENT_LINE)).toBeInTheDocument();
  });

  it('F-26.7 a failed send says so, keeps the text and the composer, and Send reply can be tried again', async () => {
    const { authorReply } = await openAuthor({ send: failOnce });
    await openQuestion();
    await userEvent.type(box(), 'Will persist it.');

    await userEvent.click(named('Send reply'));

    expect(await within(await card()).findByRole('alert')).toHaveTextContent(
      "GitLab isn't reachable.",
    );
    expect(box()).toHaveValue('Will persist it.');
    expect(named('Send reply')).toBeEnabled();
    expect(screen.queryByText(SENT_LINE)).toBeNull();
    expect(within(option(/Piotr S\./)).getByText('Question')).toBeInTheDocument();

    await userEvent.click(named('Send reply'));
    expect(await within(await card()).findByText(SENT_LINE)).toBeInTheDocument();
    expect(authorReply).toHaveBeenCalledTimes(2);
  });

  it('F-26.7 a question already answered when the screen opens reads the sentence and has no composer', async () => {
    const { claudeReplyDraft } = await openAuthor({
      threads: (all) => {
        const [first, second] = all;
        if (!first || !second) throw new Error('the mock has two threads');
        return [
          first,
          {
            ...second,
            status: 'answered',
            notes: [
              ...second.notes,
              {
                author: 'Bartek K.',
                avatar: 'BK',
                body: 'It is lost today; I will fix it.',
                createdAt: new Date(Date.now() - 3_600_000).toISOString(),
                mine: true,
              },
            ],
          },
        ];
      },
    });
    await card();
    await userEvent.click(option(/Piotr S\./));

    const thread = within(await card());
    expect(await thread.findByText(SENT_LINE)).toBeInTheDocument();
    expect(thread.getByText('It is lost today; I will fix it.')).toBeInTheDocument();
    expect(thread.queryByRole('textbox')).toBeNull();
    expect(thread.queryByRole('button', { name: 'Send reply' })).toBeNull();
    expect(thread.queryByRole('button', { name: 'Draft with Claude' })).toBeNull();
    expect(claudeReplyDraft).not.toHaveBeenCalled();
  });

  it('F-26.7 the typed text and a finished draft stay with the thread when another thread is picked and the thread is opened again', async () => {
    const run = deferred<{ reply: string }>();
    const draft = vi.fn<Draft>(() => run.promise);
    await openAuthor({ draft });
    await openQuestion();
    await userEvent.type(box(), 'Typed before leaving');

    await userEvent.click(option(/Marta K\./));
    await within(await card()).findByRole('button', { name: 'Fix in Rider' });
    await userEvent.click(option(/Piotr S\./));
    await screen.findByRole('textbox', { name: 'Your reply' });
    expect(box()).toHaveValue('Typed before leaving');

    // A draft that lands while another thread is open is there on return, not lost.
    await userEvent.click(named('Draft with Claude'));
    expect(await within(await card()).findByRole('button', { name: 'Drafting…' })).toBeDisabled();
    await userEvent.click(option(/Marta K\./));
    await within(await card()).findByRole('button', { name: 'Fix in Rider' });
    await userEvent.click(option(/Piotr S\./));
    expect(await within(await card()).findByRole('button', { name: 'Drafting…' })).toBeDisabled();
    await userEvent.click(option(/Marta K\./));
    await within(await card()).findByRole('button', { name: 'Fix in Rider' });
    run.resolve({ reply: DRAFT });
    await userEvent.click(option(/Piotr S\./));

    await waitFor(() => {
      expect(box()).toHaveValue(DRAFT);
    });
    expect(draft).toHaveBeenCalledTimes(1);
    expect(named('Draft with Claude')).toBeEnabled();
  });

  it('F-26.7 a failed send keeps its error across picking another thread, and a reply sent while away is shown as Answered', async () => {
    const run = deferred<undefined>();
    let calls = 0;
    await openAuthor({
      send:
        (real) =>
        async (...args) => {
          calls += 1;
          if (calls === 1) throw unreachable();
          await run.promise;
          return real(...args);
        },
    });
    await openQuestion();
    await userEvent.type(box(), 'Will persist it.');
    await userEvent.click(named('Send reply'));
    await within(await card()).findByRole('alert');

    await userEvent.click(option(/Marta K\./));
    await within(await card()).findByRole('button', { name: 'Fix in Rider' });
    await userEvent.click(option(/Piotr S\./));
    expect(await within(await card()).findByRole('alert')).toHaveTextContent(
      "GitLab isn't reachable.",
    );
    expect(box()).toHaveValue('Will persist it.');

    // Send again, leave while it is on its way, come back after it was delivered.
    await userEvent.click(named('Send reply'));
    await waitFor(() => {
      expect(named('Send reply')).toBeDisabled();
    });
    await userEvent.click(option(/Marta K\./));
    await within(await card()).findByRole('button', { name: 'Fix in Rider' });
    await userEvent.click(option(/Piotr S\./));
    // Still on its way: the busy state belongs to the thread.
    expect(await within(await card()).findByRole('button', { name: 'Send reply' })).toBeDisabled();
    await userEvent.click(option(/Marta K\./));
    await within(await card()).findByRole('button', { name: 'Fix in Rider' });
    run.resolve(undefined);
    await userEvent.click(option(/Piotr S\./));
    expect(await within(await card()).findByText(SENT_LINE)).toBeInTheDocument();
  });
});
