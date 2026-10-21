import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-26.1: S-10 Your MR, left panel (Author.dc.html, M7 decision 5). Against the mock backend's !480
// (Marta K. UploadWorker.cs:46 Change requested, Piotr S. UploadWorker.cs:36 Question, one thread
// resolved earlier) and against replaced `authorMr(project, iid)` answers for the rest.
//
// Locators the screen keeps:
//  - <aside aria-label="Threads on your MR"> (role complementary) with, in this order: a label
//    "Feedback on your MR", <h1> "2 threads to answer" / "1 thread to answer" / "All answered"
//    (the case of the text; CSS uppercases), the branch line "feature/upload-retry → develop",
//    the thread list, the resolved summary and the safety note.
//  - <div role="listbox" aria-label="Threads"> with one <button role="option"> per thread in the
//    core's order: aria-selected on the selected one (the first at the start), roving tabindex
//    (0 on the selected option, -1 on the others), arrow keys move the selection and the focus.
//    The option holds, as separate elements: the avatar (text "MK", aria-hidden="true",
//    data-color), the author "Marta K.", the place "UploadWorker.cs:46", the excerpt and the
//    status tag. The tag is the element whose own text is the word and carries data-color.
//  - the resolved summary is one element with the text "1 resolved earlier · typo in a log
//    message"; absent when nothing is resolved.
//  - the safety note: the elements "Fixes stay on your branch" and "Claude may edit only the
//    file a thread points at. You accept every change, commit and push yourself."
//  - a failed read as role="alert" holding the error message.

const PROJECT = 'mobile/mobile-app';
const IID = 480;
/** Commands that may run Claude or call GitLab; a restored screen calls none of them (F-30.4). */
const WORK = /^(review|gitlab|pipeline|author|claude(?!Status$|Models$|Activity$))/;

type AuthorMr = Awaited<ReturnType<IpcClient['authorMr']>>;
type Thread = AuthorMr['threads'][number];

async function backend(override: (base: AuthorMr) => Partial<AuthorMr> = () => ({})) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const mr = await base.authorMr(PROJECT, IID);
  const authorMr = vi.fn(() => Promise.resolve({ ...mr, ...override(mr) }));
  return { ...recordingClient({ ...base, authorMr }), authorMr, mr };
}

/** S-01, then S-10 of !480 opened by navigation (not as a restored start). */
async function openAuthor(override?: (base: AuthorMr) => Partial<AuthorMr>) {
  const rec = await backend(override);
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: IID })));
  return { ...app, ...rec };
}

const panel = () => screen.findByRole('complementary', { name: 'Threads on your MR' });
const options = () =>
  within(screen.getByRole('listbox', { name: 'Threads' })).getAllByRole('option');
const option = (name: RegExp) => {
  const found = options().find((o) => name.test(o.textContent));
  if (!found) throw new Error(`no thread option ${String(name)}`);
  return found;
};

const thread = (over: Partial<Thread>): Thread => ({
  id: 't9',
  author: 'Marta K.',
  avatar: 'MK',
  place: 'UploadWorker.cs:46',
  path: 'src/App/Workers/UploadWorker.cs',
  line: 46,
  excerpt: 'Rename this.',
  kind: 'change',
  status: 'changeRequested',
  notes: [],
  ...over,
});

describe('S-10 left panel header (F-26.1)', () => {
  it('F-26.1 shows "Feedback on your MR", "2 threads to answer" and the branch line', async () => {
    await openAuthor();

    const aside = within(await panel());
    expect(aside.getByText('Feedback on your MR')).toBeInTheDocument();
    expect(
      aside.getByRole('heading', { level: 1, name: '2 threads to answer' }),
    ).toBeInTheDocument();
    expect(aside.getByText('feature/upload-retry → develop')).toBeInTheDocument();
  });

  it('F-26.1 the count is the core’s toAnswer, not the length of the list; one thread is singular', async () => {
    await openAuthor((mr) => ({
      toAnswer: 1,
      threads: [...mr.threads, thread({ id: 't3', status: 'answered', kind: 'question' })],
    }));

    expect(
      await screen.findByRole('heading', { level: 1, name: '1 thread to answer' }),
    ).toBeInTheDocument();
    expect(options()).toHaveLength(3);
  });

  it('F-26.1 nothing to answer reads "All answered"', async () => {
    await openAuthor(() => ({ toAnswer: 0 }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'All answered' }),
    ).toBeInTheDocument();
  });

  it('F-26.1 reads the MR of the route from the active repository’s GitLab project', async () => {
    const { authorMr } = await openAuthor();

    await screen.findByRole('heading', { level: 1, name: '2 threads to answer' });
    expect(authorMr).toHaveBeenCalledWith(PROJECT, IID);
  });
});

describe('S-10 thread list (F-26.1)', () => {
  it('F-26.1 lists the threads with avatar, author, file:line, excerpt and status tag', async () => {
    await openAuthor();
    await panel();

    const [marta, piotr] = options();
    if (!marta || !piotr) throw new Error('two threads expected');
    expect(options()).toHaveLength(2);
    expect(within(marta).getByText('MK')).toHaveAttribute('aria-hidden', 'true');
    expect(within(marta).getByText('MK')).toHaveAttribute('data-color', 'green');
    expect(within(marta).getByText('Marta K.')).toBeInTheDocument();
    expect(within(marta).getByText('UploadWorker.cs:46')).toBeInTheDocument();
    expect(
      within(marta).getByText(
        'The delay grows linearly. Can we make it exponential with a cap? With MaxAttempts raised later we’d hammer the API.',
      ),
    ).toBeInTheDocument();
    expect(within(marta).getByText('Change requested')).toBeInTheDocument();
    expect(within(piotr).getByText('PS')).toHaveAttribute('data-color', 'orange');
    expect(within(piotr).getByText('Piotr S.')).toBeInTheDocument();
    expect(within(piotr).getByText('UploadWorker.cs:36')).toBeInTheDocument();
    expect(within(piotr).getByText('Question')).toBeInTheDocument();
  });

  it('F-26.1 the question tag is blue and the change request orange, not the mock’s orange for both', async () => {
    await openAuthor();
    await panel();

    expect(within(option(/Piotr S\./)).getByText('Question')).toHaveAttribute('data-color', 'blue');
    expect(within(option(/Marta K\./)).getByText('Change requested')).toHaveAttribute(
      'data-color',
      'orange',
    );
  });

  it.each([
    ['changeRequested', 'Change requested', 'orange'],
    ['question', 'Question', 'blue'],
    ['fixProposed', 'Fix proposed', 'purple'],
    ['fixedLocally', 'Fixed locally · not pushed', 'yellow'],
    ['replied', 'Replied', 'blue'],
    ['answered', 'Answered', 'blue'],
  ] as const)('F-26.1 status %s reads "%s" in %s', async (status, word, color) => {
    await openAuthor(() => ({ threads: [thread({ status })] }));
    await panel();

    expect(within(options()[0] as HTMLElement).getByText(word)).toHaveAttribute(
      'data-color',
      color,
    );
  });

  it('F-26.1 the first thread is selected at the start; clicking another selects it', async () => {
    const user = userEvent.setup();
    await openAuthor();
    await panel();

    expect(option(/Marta K\./)).toHaveAttribute('aria-selected', 'true');
    expect(option(/Piotr S\./)).toHaveAttribute('aria-selected', 'false');
    await user.click(option(/Piotr S\./));
    expect(option(/Piotr S\./)).toHaveAttribute('aria-selected', 'true');
    expect(option(/Marta K\./)).toHaveAttribute('aria-selected', 'false');
  });

  it('F-26.1 arrow keys move the selection and the focus; roving tabindex keeps one tab stop', async () => {
    const user = userEvent.setup();
    await openAuthor();
    await panel();
    expect(option(/Marta K\./)).toHaveAttribute('tabindex', '0');
    expect(option(/Piotr S\./)).toHaveAttribute('tabindex', '-1');

    act(() => {
      option(/Marta K\./).focus();
    });
    await user.keyboard('{ArrowDown}');
    expect(option(/Piotr S\./)).toHaveAttribute('aria-selected', 'true');
    expect(option(/Piotr S\./)).toHaveFocus();
    expect(option(/Piotr S\./)).toHaveAttribute('tabindex', '0');
    expect(option(/Marta K\./)).toHaveAttribute('tabindex', '-1');

    await user.keyboard('{ArrowDown}');
    expect(option(/Piotr S\./)).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowUp}');
    expect(option(/Marta K\./)).toHaveAttribute('aria-selected', 'true');
    expect(option(/Marta K\./)).toHaveFocus();
  });
});

describe('S-10 resolved summary and safety note (F-26.1)', () => {
  it('F-26.1 "1 resolved earlier · typo in a log message" closes the list', async () => {
    await openAuthor();
    await panel();

    expect(screen.getByText('1 resolved earlier · typo in a log message')).toBeInTheDocument();
  });

  it('F-26.1 several resolved threads read "3 resolved earlier · <first>"', async () => {
    await openAuthor(() => ({ resolved: { count: 3, firstExcerpt: 'Missing newline' } }));
    expect(await screen.findByText('3 resolved earlier · Missing newline')).toBeInTheDocument();
  });

  it('F-26.1 a resolved count without an excerpt shows only the count', async () => {
    await openAuthor(() => ({ resolved: { count: 2, firstExcerpt: null } }));
    expect(await screen.findByText('2 resolved earlier')).toBeInTheDocument();
  });

  it('F-26.1 nothing resolved shows no summary', async () => {
    await openAuthor(() => ({ resolved: { count: 0, firstExcerpt: null } }));
    await panel();

    await screen.findByRole('heading', { level: 1, name: '2 threads to answer' });
    expect(screen.queryByText(/resolved earlier/)).toBeNull();
  });

  it('F-26.1 the note says fixes stay on your branch and that you accept, commit and push', async () => {
    await openAuthor();

    const aside = within(await panel());
    expect(aside.getByText('Fixes stay on your branch')).toBeInTheDocument();
    expect(
      aside.getByText(
        'Claude may edit only the file a thread points at. You accept every change, commit and push yourself.',
      ),
    ).toBeInTheDocument();
  });
});

describe('S-10 while loading, on errors and restored (F-26.1, F-30.4)', () => {
  it('F-26.1 while the MR loads no thread, count, summary or pipeline status is shown', async () => {
    const rec = await backend();
    const never = vi.fn(() => new Promise<AuthorMr>(() => undefined));
    const app = renderApp({ screen: 'S-01' }, { ...rec.client, authorMr: never });
    await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: IID })));

    await waitFor(() => {
      expect(never).toHaveBeenCalled();
    });
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.queryByText(/threads? to answer/)).toBeNull();
    expect(screen.queryByText('All answered')).toBeNull();
    expect(screen.queryByText(/resolved earlier/)).toBeNull();
    expect(within(screen.getByTestId('title-bar')).queryByText(/^Pipeline /)).toBeNull();
  });

  it('F-26.1 a failed read shows its message as an alert and no thread list', async () => {
    const authorMr = () =>
      Promise.reject(
        new IpcError({
          code: 'GITLAB_UNREACHABLE',
          message: 'GitLab isn’t reachable.',
          retryable: true,
        }),
      );
    const rec = await backend();
    const app = renderApp({ screen: 'S-01' }, { ...rec.client, authorMr });
    await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: IID })));

    expect(await screen.findByRole('alert')).toHaveTextContent('GitLab isn’t reachable.');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();
    expect(within(screen.getByTestId('title-bar')).queryByText(/^Pipeline /)).toBeNull();
  });

  it('F-26.1 a restored start (F-30.4) reads no MR and no GitLab: it asks to open the MR again', async () => {
    const rec = await backend();
    renderApp({ screen: 'S-10', iid: IID }, rec.client);

    expect(await screen.findByText('Open the MR again to load it.')).toBeInTheDocument();
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.queryByText(/threads? to answer/)).toBeNull();
    await waitFor(() => {
      expect(rec.calls).toContain('sessionsListUnfinished');
    });
    expect(rec.calls.filter((name) => WORK.test(name))).toEqual([]);
  });
});
