import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import type { GitlabScenario } from '../../ipc/mock/gitlab';
import type { DiffPosition } from '../../ipc/types/DiffPosition';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-12.5: Publish (N) on the Drafts tab of S-05 (SummaryDesk.dc.html, plan M5, decisions 8 to 10).
// The button sits in the head row next to the tabs (Drafts tab only) and is named "Publish (N)"
// with N = the ticked drafts that are not published yet; the summary comment does not count. One
// click is one `draftsPublish(session, ids in list order, summary text or null)`. While it runs
// the button shows a spinner (aria-busy, same name, disabled) and the list is locked. Afterwards
// the blue banner "Published N comment(s)[ and a summary]. The author got a single notification."
// (role status), each sent row reads "file:line · published", and the button reads "Published"
// (disabled) until another draft is ticked. A partial failure says "Published 3 of 5. 2 failed:
// <reason of the first failure>." with Retry; failed rows keep their tick and show their own
// reason; Retry sends only the failed rows. Decision 8: a yellow banner for the draft comments
// already in GitLab's own review, never on a restored start (no GitLab command, F-30.4).
// Decision 10b: an outdated draft is unticked and says why.
//
// Locators the screen keeps: the button named "Publish (N)" / "Published" outside the tabpanel,
// the banner as role status whose text is the sentence, the button "Retry" inside the failure
// banner, the reasons as plain text inside the row, `role="alert"` for a failed call. The drafts
// go through the mock backend (real `draftsPublish`), the scenario knobs are `publishFails` and
// `foreignDrafts` (GitlabScenario).

const MR_SESSION = 'mock-mr-session-1';
const WORK = /^(review|gitlab|claude(?!Status$|Models$))/;
const DOT = '·';
const SINGLE = 'The author got a single notification.';
const LINE_GONE = 'the line is no longer in the MR';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const WORKER = 'src/Mobile.Infrastructure/Uploads/UploadWorker.cs';
const PENDING = 'src/Mobile.Core/Uploads/PendingUpload.cs';
const PAGE = 'src/Mobile.App/Views/DeliveryPhotoPage.xaml';

const at = (file: string, line: number): DiffPosition => ({ file, side: 'new', line });
const SEEDS = [
  { body: 'Consider a separate catch for OperationCanceledException.', position: at(VM, 54) },
  { body: 'PendingCount doesn’t refresh after the worker uploads.', position: at(VM, 49) },
  { body: 'Retries have no upper limit.', position: at(WORKER, 71) },
  { body: 'Did we consider saving the photo to disk?', position: at(PENDING, 5) },
  { body: 'Nit: the banner has a fixed height.', position: at(PAGE, 41) },
] as const;
const LOCS = [
  'DeliveryPhotoViewModel.cs:54',
  'DeliveryPhotoViewModel.cs:49',
  'UploadWorker.cs:71',
  'PendingUpload.cs:5',
  'DeliveryPhotoPage.xaml:41',
];
const SUMMARY = 'Looks good overall, two things before merging.';

interface Options {
  gitlab?: GitlabScenario;
  drafts?: number;
  /** The "Add a summary comment" tick and text kept for the session. */
  summary?: { enabled: boolean; text: string };
}

/** The mock backend of an MR session whose plan is read and whose drafts were really made. */
async function backend({ gitlab = {}, drafts = 5, summary }: Options = {}): Promise<IpcClient> {
  const base = createMockClient({ latencyMs: 0, gitlab });
  await base.repoPick();
  await base.reviewPlan(MR_SESSION, () => undefined);
  for (const seed of SEEDS.slice(0, drafts)) {
    await base.draftsCreate({ sessionId: MR_SESSION, findingId: null, severity: 'q', ...seed });
  }
  if (summary) await base.sessionSetSummary(MR_SESSION, { ...summary, suggested: false });
  return { ...base };
}

type PublishArgs = [string, string[], string | null];

/**
 * `base` whose draftsPublish records its arguments and, with `hold`, waits until `release()`.
 * `answers` replace the real answers one by one (the drafts are then left as they are).
 */
function watched(base: IpcClient, { hold = false, answers = [] as unknown[] } = {}) {
  const calls: PublishArgs[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client: IpcClient = {
    ...base,
    draftsPublish: async (session, ids, summary) => {
      calls.push([session, ids, summary]);
      if (hold) await gate;
      const answer = answers.shift();
      if (answer instanceof Error) throw answer;
      if (answer) return answer as Awaited<ReturnType<IpcClient['draftsPublish']>>;
      return base.draftsPublish(session, ids, summary);
    },
  };
  return {
    client,
    calls,
    release: () => {
      release();
    },
  };
}

async function openSummary(client: IpcClient) {
  const app = renderApp({ screen: 'S-01' }, client);
  await act(() => app.router.navigate(`/session/${MR_SESSION}/summary`));
  await within(await screen.findByRole('tabpanel')).findAllByRole('listitem');
  return app;
}

const panel = () => screen.getByRole('tabpanel');
const rows = () => within(panel()).getAllByRole('listitem');
const rowAt = (n: number): HTMLElement => {
  const row = rows()[n - 1];
  if (!row) throw new Error(`The list has no row ${String(n)}.`);
  return row;
};
const boxOf = (n: number) =>
  within(rowAt(n)).getByRole('checkbox', { name: `Publish comment ${String(n)}` });
const pencilOf = (n: number) =>
  within(rowAt(n)).queryByRole('button', { name: `Edit comment ${String(n)}` });
const publishButton = (name: string) => screen.getByRole('button', { name });
const bannerWith = (text: string) => {
  const banner = screen.getByText(text).closest('[role="status"]');
  if (!banner) throw new Error(`"${text}" is not in a status banner.`);
  return banner as HTMLElement;
};
const untick = async (...numbers: number[]) => {
  for (const n of numbers) {
    await userEvent.click(boxOf(n));
    await waitFor(() => {
      expect(boxOf(n)).not.toBeChecked();
    });
  }
};

describe('S-05 Publish button (F-12.5)', () => {
  it('F-12.5 the Drafts tab has Publish (N) with N the ticked drafts, and the Threads tab has none', async () => {
    await openSummary(await backend());
    expect(publishButton('Publish (5)')).toBeEnabled();

    await untick(2);
    expect(publishButton('Publish (4)')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Publish (5)' })).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: /^Threads/ }));
    expect(screen.queryByRole('button', { name: /^Publish \(/ })).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /^Drafts/ }));
    expect(publishButton('Publish (4)')).toBeInTheDocument();
  });

  it('F-12.5 the summary comment is not counted in N', async () => {
    await openSummary(await backend({ summary: { enabled: true, text: SUMMARY } }));
    expect(publishButton('Publish (5)')).toBeEnabled();
  });

  it('F-12.5 with nothing ticked Publish (0) is disabled and sends nothing', async () => {
    const { client, calls } = watched(await backend({ drafts: 2 }));
    await openSummary(client);
    await untick(1, 2);
    const button = publishButton('Publish (0)');
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(calls).toEqual([]);
  });
});

describe('S-05 Publish click (F-12.5)', () => {
  it('F-12.5 one click is one draftsPublish with the ticked drafts in list order and no summary', async () => {
    const mock = await backend();
    const all = (await mock.draftsList(MR_SESSION)).map((d) => d.id);
    const { client, calls } = watched(mock);
    await openSummary(client);
    await untick(2);

    await userEvent.click(publishButton('Publish (4)'));

    await screen.findByText(`Published 4 comments. ${SINGLE}`);
    expect(calls).toEqual([[MR_SESSION, [all[0], all[2], all[3], all[4]], null]]);
  });

  it('F-12.5 a ticked summary comment with text goes out in the same call', async () => {
    const mock = await backend({ summary: { enabled: true, text: SUMMARY } });
    const all = (await mock.draftsList(MR_SESSION)).map((d) => d.id);
    const { client, calls } = watched(mock);
    await openSummary(client);

    await userEvent.click(publishButton('Publish (5)'));

    await screen.findByText(`Published 5 comments and a summary. ${SINGLE}`);
    expect(calls).toEqual([[MR_SESSION, all, SUMMARY]]);
  });

  it.each([
    ['unticked', { enabled: false, text: SUMMARY }],
    ['ticked with no text', { enabled: true, text: '  ' }],
  ])('F-12.5 a summary comment that is %s is not sent', async (_, summary) => {
    const { client, calls } = watched(await backend({ drafts: 2, summary }));
    await openSummary(client);

    await userEvent.click(publishButton('Publish (2)'));

    await screen.findByText(`Published 2 comments. ${SINGLE}`);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[2]).toBeNull();
  });

  it('F-12.5 while publishing the button shows a spinner and the list is locked; a second click sends nothing', async () => {
    const { client, calls, release } = watched(
      await backend({ summary: { enabled: true, text: SUMMARY } }),
      { hold: true },
    );
    await openSummary(client);

    await userEvent.click(publishButton('Publish (5)'));

    await waitFor(() => {
      expect(publishButton('Publish (5)')).toHaveAttribute('aria-busy', 'true');
    });
    const button = publishButton('Publish (5)');
    expect(button).toBeDisabled();
    expect(button.querySelector('svg')).not.toBeNull();
    for (const n of [1, 2, 3, 4, 5]) {
      expect(boxOf(n)).toBeDisabled();
      expect(pencilOf(n)).toBeDisabled();
    }
    expect(within(panel()).getByRole('checkbox', { name: 'Add a summary comment' })).toBeDisabled();
    await userEvent.click(button);
    expect(calls).toHaveLength(1);

    release();
    await screen.findByText(`Published 5 comments and a summary. ${SINGLE}`);
    await waitFor(() => {
      expect(publishButton('Published')).toBeDisabled();
    });
    expect(publishButton('Published')).not.toHaveAttribute('aria-busy', 'true');
  });

  it('F-12.5 a call that fails says why, unlocks the list and offers Publish (N) again', async () => {
    const failure = new IpcError({
      code: 'GITLAB_UNAUTHORIZED',
      message: 'GitLab didn’t accept the token. Check it in Settings › GitLab.',
      retryable: false,
    });
    const { client } = watched(await backend({ drafts: 2 }), { answers: [failure] });
    await openSummary(client);

    await userEvent.click(publishButton('Publish (2)'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'GitLab didn’t accept the token. Check it in Settings › GitLab.',
    );
    expect(screen.queryByText(/The author got a single notification/)).toBeNull();
    expect(publishButton('Publish (2)')).toBeEnabled();
    expect(boxOf(1)).toBeEnabled();
    expect(pencilOf(1)).toBeEnabled();
  });
});

describe('S-05 after Publish (F-12.5)', () => {
  it('F-12.5 the blue banner, every sent row marked published and the button read Published', async () => {
    await openSummary(await backend());

    await userEvent.click(publishButton('Publish (5)'));

    await screen.findByText(`Published 5 comments. ${SINGLE}`);
    expect(bannerWith(`Published 5 comments. ${SINGLE}`)).toBeInTheDocument();
    for (const n of [1, 2, 3, 4, 5]) {
      await waitFor(() => {
        expect(rowAt(n)).toHaveTextContent(`${LOCS[n - 1] ?? ''} ${DOT} published`);
      });
      expect(boxOf(n)).toBeChecked();
      expect(boxOf(n)).toBeDisabled();
      expect(pencilOf(n)).toBeNull();
    }
    expect(within(panel()).getByText('Published to GitLab.')).toBeInTheDocument();
    const done = publishButton('Published');
    expect(done).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Publish \(/ })).toBeNull();
  });

  it.each([
    [1, false, 'Published 1 comment.'],
    [5, true, 'Published 5 comments and a summary.'],
    [1, true, 'Published 1 comment and a summary.'],
  ])(
    'F-12.5 the banner for %i draft(s) and a summary %s reads "%s The author got a single notification."',
    async (n, withSummary, sentence) => {
      const summary = withSummary ? { enabled: true, text: SUMMARY } : undefined;
      await openSummary(await backend({ summary }));
      if (n === 1) await untick(2, 3, 4, 5);

      await userEvent.click(publishButton(`Publish (${String(n)})`));

      expect(await screen.findByText(`${sentence} ${SINGLE}`)).toBeInTheDocument();
      expect(bannerWith(`${sentence} ${SINGLE}`)).toBeInTheDocument();
    },
  );

  it('F-12.5 an unticked draft stays unpublished and editable, and ticking it enables another Publish', async () => {
    await openSummary(await backend());
    await untick(5);

    await userEvent.click(publishButton('Publish (4)'));
    await screen.findByText(`Published 4 comments. ${SINGLE}`);

    await waitFor(() => {
      expect(rowAt(4)).toHaveTextContent(`${DOT} published`);
    });
    expect(rowAt(5)).not.toHaveTextContent('published');
    expect(boxOf(5)).toBeEnabled();
    expect(boxOf(5)).not.toBeChecked();
    expect(pencilOf(5)).toBeEnabled();
    expect(
      within(panel()).getByText('Only you can see drafts until you publish them.'),
    ).toBeInTheDocument();
    expect(publishButton('Published')).toBeDisabled();

    await userEvent.click(boxOf(5));
    await waitFor(() => {
      expect(publishButton('Publish (1)')).toBeEnabled();
    });
  });
});

describe('S-05 partial failure and Retry (F-12.5, M5 decision 9)', () => {
  const failure = 'Published 3 of 5. 2 failed: the line is no longer in the MR.';

  it('F-12.5 the banner says how many went out and why, failed rows keep their tick and show their own reason', async () => {
    await openSummary(await backend({ gitlab: { publishFails: [2, 4] } }));

    await userEvent.click(publishButton('Publish (5)'));

    await screen.findByText(failure);
    const banner = bannerWith(failure);
    expect(within(banner).getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.queryByText(/The author got a single notification/)).toBeNull();
    for (const n of [2, 4]) {
      await waitFor(() => {
        expect(within(rowAt(n)).getByText(LINE_GONE)).toBeInTheDocument();
      });
      expect(rowAt(n)).not.toHaveTextContent(`${DOT} published`);
      expect(boxOf(n)).toBeChecked();
      expect(boxOf(n)).toBeEnabled();
      expect(pencilOf(n)).toBeEnabled();
    }
    for (const n of [1, 3, 5]) {
      expect(rowAt(n)).toHaveTextContent(`${LOCS[n - 1] ?? ''} ${DOT} published`);
      expect(within(rowAt(n)).queryByText(LINE_GONE)).toBeNull();
    }
    // The failed rows are still ticked, so they are what the next Publish would send.
    expect(publishButton('Publish (2)')).toBeEnabled();
  });

  it('F-12.5 Retry sends only the failed rows that are still ticked, then says what it published', async () => {
    const mock = await backend({ gitlab: { publishFails: [2, 4] } });
    const all = (await mock.draftsList(MR_SESSION)).map((d) => d.id);
    const { client, calls } = watched(mock);
    await openSummary(client);
    await userEvent.click(publishButton('Publish (5)'));
    await screen.findByText(failure);
    await waitFor(() => {
      expect(within(rowAt(2)).getByText(LINE_GONE)).toBeInTheDocument();
    });

    await userEvent.click(within(bannerWith(failure)).getByRole('button', { name: 'Retry' }));

    await screen.findByText(`Published 2 comments. ${SINGLE}`);
    expect(calls).toEqual([
      [MR_SESSION, all, null],
      [MR_SESSION, [all[1], all[3]], null],
    ]);
    expect(screen.queryByText(failure)).toBeNull();
    await waitFor(() => {
      expect(within(rowAt(2)).queryByText(LINE_GONE)).toBeNull();
    });
    expect(rowAt(2)).toHaveTextContent(`${DOT} published`);
    expect(rowAt(4)).toHaveTextContent(`${DOT} published`);
    expect(publishButton('Published')).toBeDisabled();
  });

  it('F-12.5 a failed row that was unticked before Retry is not sent again', async () => {
    const mock = await backend({ gitlab: { publishFails: [2, 4] } });
    const all = (await mock.draftsList(MR_SESSION)).map((d) => d.id);
    const { client, calls } = watched(mock);
    await openSummary(client);
    await userEvent.click(publishButton('Publish (5)'));
    await screen.findByText(failure);
    await untick(4);

    await userEvent.click(within(bannerWith(failure)).getByRole('button', { name: 'Retry' }));

    await screen.findByText(`Published 1 comment. ${SINGLE}`);
    expect(calls[1]).toEqual([MR_SESSION, [all[1]], null]);
  });

  it('F-12.5 Retry carries the summary again when the first call did not send it', async () => {
    const mock = await backend({ drafts: 1, summary: { enabled: true, text: SUMMARY } });
    const [only] = (await mock.draftsList(MR_SESSION)).map((d) => d.id);
    const first = 'Published 0 of 1. 1 failed: GitLab is unreachable.';
    const { client, calls } = watched(mock, {
      answers: [
        { published: [], summary: false, failed: [{ id: only, reason: 'GitLab is unreachable' }] },
      ],
    });
    await openSummary(client);
    await userEvent.click(publishButton('Publish (1)'));
    await screen.findByText(first);

    await userEvent.click(within(bannerWith(first)).getByRole('button', { name: 'Retry' }));

    await screen.findByText(`Published 1 comment and a summary. ${SINGLE}`);
    expect(calls).toEqual([
      [MR_SESSION, [only], SUMMARY],
      [MR_SESSION, [only], SUMMARY],
    ]);
  });

  it('F-12.5 Retry does not send the summary a second time when the first call sent it', async () => {
    const mock = await backend({ drafts: 2, summary: { enabled: true, text: SUMMARY } });
    const [one, two] = (await mock.draftsList(MR_SESSION)).map((d) => d.id);
    const first = 'Published 1 of 2. 1 failed: GitLab is unreachable.';
    const { client, calls } = watched(mock, {
      answers: [
        {
          published: [one],
          summary: true,
          failed: [{ id: two, reason: 'GitLab is unreachable' }],
        },
      ],
    });
    await openSummary(client);
    await userEvent.click(publishButton('Publish (2)'));
    await screen.findByText(first);

    await userEvent.click(within(bannerWith(first)).getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls[0]).toEqual([MR_SESSION, [one, two], SUMMARY]);
    expect(calls[1]).toEqual([MR_SESSION, [two], null]);
  });
});

describe("S-05 drafts already in GitLab's own review (F-12.5, M5 decision 8)", () => {
  const plural =
    "You have 2 draft comments in GitLab's own review. Publishing here sends them too.";
  const singular = "You have 1 draft comment in GitLab's own review. Publishing here sends it too.";

  it('F-12.5 the yellow banner counts them when the summary opens, and Publish stays available', async () => {
    await openSummary(await backend({ gitlab: { foreignDrafts: 2 } }));
    expect(await screen.findByText(plural)).toBeInTheDocument();
    expect(publishButton('Publish (5)')).toBeEnabled();
  });

  it('F-12.5 one draft reads in the singular', async () => {
    await openSummary(await backend({ gitlab: { foreignDrafts: 1 } }));
    expect(await screen.findByText(singular)).toBeInTheDocument();
  });

  it('F-12.5 no banner when GitLab holds no such drafts, and the count is asked for this session', async () => {
    const none = await backend();
    const counted = vi.spyOn(none, 'gitlabForeignDrafts');
    await openSummary(none);
    await waitFor(() => {
      expect(counted).toHaveBeenCalledWith(MR_SESSION);
    });
    expect(screen.queryByText(/draft comments? in GitLab's own review/)).toBeNull();
    expect(publishButton('Publish (5)')).toBeEnabled();
  });

  it('F-12.5 a count that can not be read leaves no banner and Publish works', async () => {
    const mock = await backend({ drafts: 2 });
    const client: IpcClient = {
      ...mock,
      gitlabForeignDrafts: () =>
        Promise.reject(
          new IpcError({
            code: 'GITLAB_UNREACHABLE',
            message: 'GitLab is unreachable.',
            retryable: true,
          }),
        ),
    };
    await openSummary(client);
    expect(screen.queryByText(/draft comments? in GitLab's own review/)).toBeNull();
    await userEvent.click(publishButton('Publish (2)'));
    await screen.findByText(`Published 2 comments. ${SINGLE}`);
  });

  it('F-12.5 the banner is gone once Publish has sent them', async () => {
    await openSummary(await backend({ gitlab: { foreignDrafts: 2 } }));
    await screen.findByText(plural);

    await userEvent.click(publishButton('Publish (5)'));

    await screen.findByText(`Published 5 comments. ${SINGLE}`);
    await waitFor(() => {
      expect(screen.queryByText(plural)).toBeNull();
    });
  });

  it('F-12.5 F-30.4 a restored S-05 does not ask GitLab and shows no banner, and Publish still works', async () => {
    const { client, calls } = recordingClient(await backend({ gitlab: { foreignDrafts: 2 } }));
    renderApp({ screen: 'S-05', sessionId: MR_SESSION }, client);
    await within(await screen.findByRole('tabpanel')).findAllByRole('listitem');
    expect(publishButton('Publish (5)')).toBeEnabled();
    expect(screen.queryByText(plural)).toBeNull();
    expect(calls.filter((name) => WORK.test(name))).toEqual([]);

    // Decision 8 checks GitLab's own review right before publishing, on a restored start too:
    // the first click is held and shows the banner, the second sends.
    await userEvent.click(publishButton('Publish (5)'));
    await screen.findByText(plural);
    expect(calls).not.toContain('draftsPublish');
    await userEvent.click(publishButton('Publish (5)'));
    await screen.findByText(`Published 5 comments. ${SINGLE}`);
    expect(calls).toContain('draftsPublish');
  });
});

describe('S-05 outdated drafts (F-12.5, M5 decision 10b)', () => {
  it('F-12.5 an outdated draft has the Outdated tag, is unticked and says its line changed; ticking it still counts', async () => {
    const client = await backend({ drafts: 3 });
    const all = await client.draftsList(MR_SESSION);
    vi.spyOn(client, 'draftsList').mockResolvedValue(
      all.map((d, index) => (index === 1 ? { ...d, outdated: true, include: false } : d)),
    );
    await openSummary(client);

    expect(within(rowAt(2)).getByText(/^outdated$/i)).toBeInTheDocument();
    expect(rowAt(2)).toHaveTextContent(
      `DeliveryPhotoViewModel.cs:49 ${DOT} line changed, published as a general comment`,
    );
    expect(boxOf(2)).not.toBeChecked();
    expect(boxOf(2)).toBeEnabled();
    expect(within(rowAt(1)).queryByText(/^outdated$/i)).toBeNull();
    expect(rowAt(1)).not.toHaveTextContent('line changed');
    // Unticked by default: Publish counts only the other two.
    expect(publishButton('Publish (2)')).toBeEnabled();
  });
});
