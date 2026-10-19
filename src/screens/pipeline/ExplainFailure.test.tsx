import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-20.7: Explain failure in the job details of S-08 (Pipeline.dc.html, M6 decisions 12 and 14).
// A failed job (also an allowed failure) shows, on the right of its log, the heading "Why it
// failed" and, before any run: "Claude reads this log and the MR diff. Nothing is posted." and
// the button "Explain failure" (a purple square in it). Claude runs only on that click.
//
// Client: `jobExplain(project, iid, job, onEvent): Promise<JobExplanation>`, with
// JobExplanation = { verdict: 'causedByMr' | 'alreadyFixed' | 'unrelated' | 'flaky' | 'unknown',
// fixedInVersion?: number, title, explanation, evidence: string[], retryRecommended: boolean,
// suggestedComment: string } (the camelCase of the core's PipelineExplanation; empty
// suggestedComment = no block).
//
// Locators the screen keeps: role=status "Reading the log and the diff…" while it runs; the
// verdict tag data-testid="explain-verdict"; the title and the explanation as text; the evidence
// chips (a `pipeline #N` chip is a button named exactly that; a `file:line` chip is plain text
// when no review session of the MR exists); the text "A retry may help." only with
// retryRecommended; "Suggested comment" with the comment text, the button "Add to drafts" and,
// after it, "In drafts. Publish it with the rest from Summary."; a failed run shows role=alert
// "Couldn't explain this failure." and the button "Retry" (exact name, not "Retry job").
//
// Decisions the tests lock (neither the spec nor the mock answers them):
//  - Add to drafts calls `draftsCreateForMr(project, iid, { body: <comment unchanged>, position:
//    null, severity: null })` once; the button is then gone and cannot be clicked twice.
//  - A result stays for its job: leaving the job and coming back shows it without asking again.
//  - Claude unavailable (claudeStatus not signed in): the button is disabled with the title
//    "Claude isn't available" and nothing is asked.

type Row = Awaited<ReturnType<IpcClient['pipelineJobs']>>[number]['jobs'][number];
type Explanation = Awaited<ReturnType<IpcClient['jobExplain']>>;
type Status = Awaited<ReturnType<IpcClient['claudeStatus']>>;

const IID = 482;
const COMMENT = 'unit-tests fails because the queue sorts by Id. Could you sort by CreatedAt?';

const row = (over: Partial<Row> & Pick<Row, 'id' | 'name'>): Row => ({
  state: 'failed',
  action: 'retry',
  durationSecs: 112,
  webUrl: `https://gitlab.local/mobile/mobile-app/-/jobs/${String(over.id)}`,
  ...over,
});

const explanation = (over: Partial<Explanation> = {}): Explanation =>
  ({
    verdict: 'causedByMr',
    title: 'Queue returned items by Id instead of CreatedAt',
    explanation: 'Both failing tests check the queue order.',
    evidence: ['SqliteUploadQueue.cs:88', 'pipeline #18342'],
    retryRecommended: false,
    suggestedComment: COMMENT,
    ...over,
  }) as Explanation;

interface Opened {
  user: ReturnType<typeof userEvent.setup>;
  asked: number[];
  drafts: { project: string; iid: number; draft: unknown }[];
  calls: string[];
}

async function openWith(
  rows: Row[],
  answers: (Explanation | Error | Promise<Explanation>)[] = [explanation()],
  status: Status = { state: 'signedIn' },
): Promise<Opened> {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const asked: number[] = [];
  const drafts: Opened['drafts'] = [];
  const rec = recordingClient({
    ...base,
    pipelineJobs: () => Promise.resolve([{ name: 'test', jobs: rows }]),
    claudeStatus: () => Promise.resolve(status),
    jobExplain: (_project: string, _iid: number, job: number) => {
      const next = answers[Math.min(asked.length, answers.length - 1)];
      asked.push(job);
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve(next as Explanation);
    },
    draftsCreateForMr: (project: string, iid: number, draft: unknown) => {
      drafts.push({ project, iid, draft });
      return Promise.resolve({ id: 'd-1', body: COMMENT } as never);
    },
  } as unknown as IpcClient);
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-08', iid: IID })));
  return { user: userEvent.setup(), asked, drafts, calls: rec.calls };
}

const panel = async () => within(await screen.findByRole('region', { name: 'Job details' }));
const explain = async () =>
  (await panel()).findByRole('button', { name: 'Explain failure', exact: true });
const FAILED = row({ id: 5, name: 'unit-tests' });

describe('S-08 Explain failure (F-20.7)', () => {
  it('F-20.7 a failed job offers Explain failure with the hint and the purple square, and Claude is not asked until the click', async () => {
    const { asked, calls } = await openWith([FAILED]);

    const details = await panel();
    expect(await details.findByText('Why it failed')).toBeInTheDocument();
    expect(
      details.getByText('Claude reads this log and the MR diff. Nothing is posted.'),
    ).toBeInTheDocument();
    const button = await explain();
    expect(button).toBeEnabled();
    expect(button.querySelector('[data-color="purple"]')).not.toBeNull();
    expect(asked).toEqual([]);
    expect(calls).not.toContain('jobExplain');
  });

  it('F-20.7 an allowed failure offers it too, a passed job does not', async () => {
    await openWith([row({ id: 6, name: 'ui-tests:android', state: 'failedAllowed' })]);
    expect(await explain()).toBeEnabled();
  });

  it('F-20.7 a passed job has no Why it failed and no Explain failure', async () => {
    await openWith([row({ id: 7, name: 'restore', state: 'passed', action: null })]);
    const details = await panel();
    await details.findByTestId('job-status');
    expect(details.queryByText('Why it failed')).toBeNull();
    expect(details.queryByRole('button', { name: 'Explain failure' })).toBeNull();
  });

  it('F-20.7 the click asks for that job and shows Reading the log and the diff… until the answer', async () => {
    let finish!: (e: Explanation) => void;
    const pending = new Promise<Explanation>((resolve) => {
      finish = resolve;
    });
    const { user, asked } = await openWith([FAILED], [pending]);

    await user.click(await explain());

    expect(await screen.findByText('Reading the log and the diff…')).toBeInTheDocument();
    expect(asked).toEqual([5]);
    expect((await panel()).queryByRole('button', { name: 'Explain failure' })).toBeNull();

    await act(async () => {
      finish(explanation());
      await pending;
    });
    expect(
      await screen.findByText('Queue returned items by Id instead of CreatedAt'),
    ).toBeVisible();
    expect(screen.queryByText('Reading the log and the diff…')).toBeNull();
  });

  it('F-20.7 the result shows the verdict, title, explanation and evidence chips', async () => {
    const { user } = await openWith([FAILED]);

    await user.click(await explain());

    const details = await panel();
    expect(await details.findByTestId('explain-verdict')).toHaveTextContent(/^Caused by this MR$/);
    expect(
      details.getByText('Queue returned items by Id instead of CreatedAt'),
    ).toBeInTheDocument();
    expect(details.getByText('Both failing tests check the queue order.')).toBeInTheDocument();
    expect(details.getByText('SqliteUploadQueue.cs:88')).toBeInTheDocument();
    expect(details.getByRole('button', { name: 'pipeline #18342' })).toBeEnabled();
    expect(details.queryByText('A retry may help.')).toBeNull();
  });

  it.each([
    [{ verdict: 'alreadyFixed', fixedInVersion: 3 }, 'Already fixed in version 3'],
    [{ verdict: 'unrelated' }, 'Unrelated'],
    [{ verdict: 'flaky' }, 'Flaky'],
    [{ verdict: 'unknown' }, 'Unknown'],
  ] satisfies [Partial<Explanation>, string][])(
    'F-20.7 the verdict %j reads %s',
    async (over, label) => {
      const { user } = await openWith([FAILED], [explanation(over)]);
      await user.click(await explain());
      expect(await (await panel()).findByTestId('explain-verdict')).toHaveTextContent(
        new RegExp(`^${label}$`),
      );
    },
  );

  it('F-20.7 a retry recommendation adds the line A retry may help.', async () => {
    const { user } = await openWith(
      [FAILED],
      [explanation({ verdict: 'flaky', retryRecommended: true })],
    );
    await user.click(await explain());
    expect(await (await panel()).findByText('A retry may help.')).toBeInTheDocument();
  });

  it('F-20.7 Add to drafts adds the suggested comment unchanged, once, and turns into the confirmation', async () => {
    const { user, drafts } = await openWith([FAILED]);
    await user.click(await explain());

    const details = await panel();
    expect(await details.findByText('Suggested comment')).toBeInTheDocument();
    expect(details.getByText(COMMENT)).toBeInTheDocument();
    const add = details.getByRole('button', { name: 'Add to drafts', exact: true });
    await user.dblClick(add);

    expect(
      await details.findByText('In drafts. Publish it with the rest from Summary.'),
    ).toBeInTheDocument();
    expect(details.queryByRole('button', { name: 'Add to drafts' })).toBeNull();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.iid).toBe(IID);
    expect(drafts[0]?.project).toBe('mobile/mobile-app');
    expect(drafts[0]?.draft).toEqual({ body: COMMENT, position: null, severity: null });
  });

  it('F-20.7 without a suggested comment there is no Suggested comment block', async () => {
    const { user } = await openWith([FAILED], [explanation({ suggestedComment: '' })]);
    await user.click(await explain());
    const details = await panel();
    await details.findByTestId('explain-verdict');
    expect(details.queryByText('Suggested comment')).toBeNull();
    expect(details.queryByRole('button', { name: 'Add to drafts' })).toBeNull();
  });

  it("F-20.7 a failed run shows Couldn't explain this failure. with Retry, which asks again", async () => {
    const { user, asked } = await openWith(
      [FAILED],
      [new IpcError({ code: 'CLAUDE_FAILED', message: 'boom', retryable: true }), explanation()],
    );
    await user.click(await explain());

    const details = await panel();
    expect(await details.findByRole('alert')).toHaveTextContent("Couldn't explain this failure.");
    await user.click(details.getByRole('button', { name: 'Retry', exact: true }));

    expect(await details.findByTestId('explain-verdict')).toBeInTheDocument();
    expect(asked).toEqual([5, 5]);
    expect(details.queryByRole('alert')).toBeNull();
  });

  it("F-20.7 Explain failure is disabled with the title Claude isn't available when Claude can't run", async () => {
    const { user, asked } = await openWith([FAILED], [explanation()], { state: 'notFound' });

    const button = await explain();
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    expect(button).toHaveAttribute('title', "Claude isn't available");
    await user.click(button);
    expect(asked).toEqual([]);
  });

  it('F-20.7 a result stays for its job: another job and back shows it without asking again', async () => {
    const other = row({ id: 8, name: 'sonar', state: 'failedAllowed' });
    const { user, asked } = await openWith([FAILED, other]);
    await user.click(await explain());
    await (await panel()).findByTestId('explain-verdict');

    await user.click(screen.getByRole('button', { name: 'sonar, Failed · allowed' }));
    expect(await explain()).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'unit-tests, Failed' }));

    expect(await (await panel()).findByTestId('explain-verdict')).toBeInTheDocument();
    expect(asked).toEqual([5]);
  });
});
