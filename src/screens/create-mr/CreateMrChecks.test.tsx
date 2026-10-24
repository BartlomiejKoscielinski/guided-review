import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { renderApp } from '../../test/renderApp';

// F-27.5 on S-11 (route {screen:'S-11'}), "Before you create" in the aside "Reviewers and checks".
// Locators the screen keeps: the region "Before you create" (aria-busy="true" while the checks load)
// with one listitem per check in the order Branch pushed, Conflicts, Self-review; each listitem
// carries data-state="ok" (green square) or "warn" (orange square), holds its label and its note
// as two separate text elements, and the failing branch check holds the button "Push now"; the
// banner is the region "Existing merge request"; the button is "Create merge request" / "Create
// draft MR". Decisions of the tests stage (M7 decision 19 gives the blocking):
// - Only not pushed (state notPushed) and an existing MR disable Create; ahead (the remote branch
//   is behind HEAD), conflicts and a self-review that is missing or unfinished are orange and
//   leave Create enabled. While the checks load Create is disabled; if they fail the region shows
//   the error and Create stays enabled (unknown is not a reason to block).
// - Copy the spec and the mock do not give: not pushed "Branch not pushed" / "origin/<branch> does
//   not exist yet."; ahead "Branch not up to date" / "origin/<branch> is behind your latest
//   commit."; while pushing the button reads "Pushing…" and is disabled; a failed push shows its
//   message as an alert in the item and the button comes back; one conflict "1 file: x", many
//   "5 files: a, b, c and 2 more" (three names, then the rest counted); singular "1 of 1 step",
//   "1 open note"; the self-review is done when all its steps are reviewed, whatever its open
//   notes; a self-review with no steps (no plan yet) counts as none.
// - The existing MR banner: "This branch already has an open merge request." with the link "!482"
//   (in the app: S-10, /mr/482/author) and the MR's title as text.

type Check = Awaited<ReturnType<IpcClient['gitMergeCheck']>>;

const BRANCH = 'chore/compiled-bindings';

const base = (target = 'develop'): Check => ({
  branch: BRANCH,
  target,
  pushed: 'pushed',
  conflicts: [],
  selfReview: { reviewed: 6, total: 6, notes: 0 },
});

function show(make: (target: string) => Check, extra: Partial<IpcClient> = {}) {
  return renderApp(
    { screen: 'S-11' },
    { gitMergeCheck: (target) => Promise.resolve(make(target ?? 'develop')), ...extra },
  );
}

const region = () => screen.findByRole('region', { name: 'Before you create' });
const create = () => screen.getByRole('button', { name: /^Create (merge request|draft MR)$/ });
const targetSelect = () => screen.findByRole('combobox', { name: 'Target branch' });

/** The three checks once they are on screen: [branch, conflicts, self-review]. */
async function checks() {
  const box = await region();
  await waitFor(() => {
    expect(within(box).getAllByRole('listitem')).toHaveLength(3);
  });
  const [branch, conflicts, review] = within(box).getAllByRole('listitem');
  if (!branch || !conflicts || !review) throw new Error('three checks expected');
  return { box, branch, conflicts, review };
}

describe('S-11 Before you create (F-27.5)', () => {
  it('F-27.5 lists Branch pushed, No conflicts with develop and Self-review done with the notes of the mock', async () => {
    renderApp({ screen: 'S-11' });
    const { box, branch, conflicts, review } = await checks();
    expect(within(box).getByRole('heading', { name: 'Before you create' })).toBeVisible();
    expect(within(branch).getByText('Branch pushed')).toBeVisible();
    expect(within(branch).getByText('origin/chore/compiled-bindings is up to date')).toBeVisible();
    expect(within(conflicts).getByText('No conflicts with develop')).toBeVisible();
    expect(within(conflicts).getByText('checked locally with git merge-tree')).toBeVisible();
    expect(within(review).getByText('Self-review done')).toBeVisible();
    expect(within(review).getByText('6 of 6 steps · 0 open notes')).toBeVisible();
    for (const item of [branch, conflicts, review]) {
      expect(item).toHaveAttribute('data-state', 'ok');
    }
    expect(within(box).queryByRole('button', { name: 'Push now' })).toBeNull();
  });

  it('F-27.5 sits in the aside below the Reviewers and above the Create button', async () => {
    renderApp({ screen: 'S-11' });
    const { box } = await checks();
    const aside = screen.getByRole('complementary', { name: 'Reviewers and checks' });
    expect(aside).toContainElement(box);
    const reviewers = within(aside).getByRole('region', { name: 'Reviewers' });
    expect(reviewers.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(create()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('F-27.5 a branch that is not pushed is orange with Push now and Create disabled', async () => {
    show((target) => ({ ...base(target), pushed: 'notPushed' }));
    const { branch, conflicts, review } = await checks();
    expect(branch).toHaveAttribute('data-state', 'warn');
    expect(within(branch).getByText('Branch not pushed')).toBeVisible();
    expect(
      within(branch).getByText('origin/chore/compiled-bindings does not exist yet.'),
    ).toBeVisible();
    expect(within(branch).getByRole('button', { name: 'Push now' })).toBeEnabled();
    expect(conflicts).toHaveAttribute('data-state', 'ok');
    expect(review).toHaveAttribute('data-state', 'ok');
    expect(create()).toBeDisabled();
  });

  it('F-27.5 a branch behind your latest commit is orange with Push now but Create stays enabled', async () => {
    show((target) => ({ ...base(target), pushed: 'ahead' }));
    const { branch } = await checks();
    expect(branch).toHaveAttribute('data-state', 'warn');
    expect(within(branch).getByText('Branch not up to date')).toBeVisible();
    expect(
      within(branch).getByText('origin/chore/compiled-bindings is behind your latest commit.'),
    ).toBeVisible();
    expect(within(branch).getByRole('button', { name: 'Push now' })).toBeEnabled();
    expect(create()).toBeEnabled();
  });

  it('F-27.5 Push now pushes once, reads the checks again and turns the check green', async () => {
    const user = userEvent.setup();
    let pushed = false;
    let pushes = 0;
    let reads = 0;
    show(
      (target) => {
        reads += 1;
        return { ...base(target), pushed: pushed ? 'pushed' : 'notPushed' };
      },
      {
        gitPush: () => {
          pushes += 1;
          pushed = true;
          return Promise.resolve({ remoteBranch: `origin/${BRANCH}` });
        },
      },
    );
    const { branch } = await checks();
    const readsBefore = reads;
    await user.click(within(branch).getByRole('button', { name: 'Push now' }));
    await waitFor(() => {
      expect(within(branch).getByText('Branch pushed')).toBeVisible();
    });
    expect(pushes).toBe(1);
    expect(reads).toBeGreaterThan(readsBefore);
    expect(branch).toHaveAttribute('data-state', 'ok');
    expect(within(branch).queryByRole('button', { name: 'Push now' })).toBeNull();
    expect(create()).toBeEnabled();
  });

  it('F-27.5 while the push runs the button reads Pushing… and cannot be clicked again', async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    let pushes = 0;
    show((target) => ({ ...base(target), pushed: 'notPushed' }), {
      gitPush: () => {
        pushes += 1;
        return new Promise((resolve) => {
          release = () => {
            resolve({ remoteBranch: `origin/${BRANCH}` });
          };
        });
      },
    });
    const { branch } = await checks();
    await user.click(within(branch).getByRole('button', { name: 'Push now' }));
    const busy = await within(branch).findByRole('button', { name: 'Pushing…' });
    expect(busy).toBeDisabled();
    expect(within(branch).queryByRole('button', { name: 'Push now' })).toBeNull();
    await user.click(busy);
    expect(pushes).toBe(1);
    release();
  });

  it('F-27.5 a push that fails says why in the item and offers Push now again', async () => {
    const user = userEvent.setup();
    show((target) => ({ ...base(target), pushed: 'notPushed' }), {
      gitPush: () =>
        Promise.reject(
          new IpcError({
            code: 'CONFLICT',
            message: "Push rejected: the remote has commits you don't have.",
            retryable: false,
          }),
        ),
    });
    const { branch } = await checks();
    await user.click(within(branch).getByRole('button', { name: 'Push now' }));
    expect(await within(branch).findByRole('alert')).toHaveTextContent(
      "Push rejected: the remote has commits you don't have.",
    );
    expect(within(branch).getByRole('button', { name: 'Push now' })).toBeEnabled();
    expect(branch).toHaveAttribute('data-state', 'warn');
  });

  it('F-27.5 conflicts are orange: "Conflicts with <target>" with the count and the files', async () => {
    show((target) => ({ ...base(target), conflicts: ['MauiProgram.cs', 'App.xaml'] }));
    const { conflicts } = await checks();
    expect(conflicts).toHaveAttribute('data-state', 'warn');
    expect(within(conflicts).getByText('Conflicts with develop')).toBeVisible();
    expect(within(conflicts).getByText('2 files: MauiProgram.cs, App.xaml')).toBeVisible();
    expect(create()).toBeEnabled();
  });

  it('F-27.5 one conflicting file reads "1 file", a long list names three and counts the rest', async () => {
    const { unmount } = show((target) => ({ ...base(target), conflicts: ['Ścieżka ą.cs'] }));
    const { conflicts } = await checks();
    expect(within(conflicts).getByText('1 file: Ścieżka ą.cs')).toBeVisible();
    unmount();
    show((target) => ({ ...base(target), conflicts: ['a.cs', 'b.cs', 'c.cs', 'd.cs', 'e.cs'] }));
    const long = await checks();
    expect(within(long.conflicts).getByText('5 files: a.cs, b.cs, c.cs and 2 more')).toBeVisible();
  });

  it('F-27.5 choosing another target checks that target', async () => {
    const user = userEvent.setup();
    const asked: (string | undefined)[] = [];
    renderApp(
      { screen: 'S-11' },
      {
        gitMergeCheck: (target) => {
          asked.push(target);
          return Promise.resolve(
            target === 'main'
              ? { ...base('main'), conflicts: ['MauiProgram.cs', 'App.xaml'] }
              : base(target ?? 'develop'),
          );
        },
      },
    );
    const first = await checks();
    expect(within(first.conflicts).getByText('No conflicts with develop')).toBeVisible();
    await user.selectOptions(await targetSelect(), 'main');
    await waitFor(() => {
      expect(within(first.conflicts).getByText('Conflicts with main')).toBeVisible();
    });
    expect(within(first.conflicts).getByText('2 files: MauiProgram.cs, App.xaml')).toBeVisible();
    expect(asked.at(-1)).toBe('main');
    await user.selectOptions(await targetSelect(), 'develop');
    await waitFor(() => {
      expect(within(first.conflicts).getByText('No conflicts with develop')).toBeVisible();
    });
  });

  it('F-27.5 the default mock backend conflicts with main in the two files of CreateMR.dc.html', async () => {
    const user = userEvent.setup();
    renderApp({ screen: 'S-11' });
    const first = await checks();
    await user.selectOptions(await targetSelect(), 'main');
    await waitFor(() => {
      expect(within(first.conflicts).getByText('Conflicts with main')).toBeVisible();
    });
    expect(within(first.conflicts).getByText('2 files: MauiProgram.cs, App.xaml')).toBeVisible();
  });

  it('F-27.5 an unfinished self-review is orange with its numbers and leaves Create enabled', async () => {
    show((target) => ({ ...base(target), selfReview: { reviewed: 4, total: 6, notes: 2 } }));
    const { review } = await checks();
    expect(review).toHaveAttribute('data-state', 'warn');
    expect(within(review).getByText('Self-review not done')).toBeVisible();
    expect(within(review).getByText('4 of 6 steps · 2 open notes')).toBeVisible();
    expect(create()).toBeEnabled();
  });

  it('F-27.5 no self-review is orange: "Self-review not done" / "No self-review of this branch yet."', async () => {
    show((target) => {
      const check = base(target);
      delete check.selfReview;
      return check;
    });
    const { review } = await checks();
    expect(review).toHaveAttribute('data-state', 'warn');
    expect(within(review).getByText('Self-review not done')).toBeVisible();
    expect(within(review).getByText('No self-review of this branch yet.')).toBeVisible();
    expect(create()).toBeEnabled();
  });

  it('F-27.5 a self-review that has no steps yet counts as none', async () => {
    show((target) => ({ ...base(target), selfReview: { reviewed: 0, total: 0, notes: 0 } }));
    const { review } = await checks();
    expect(review).toHaveAttribute('data-state', 'warn');
    expect(within(review).getByText('No self-review of this branch yet.')).toBeVisible();
  });

  it('F-27.5 a self-review with every step reviewed is done, open notes or not, and says 1 step / 1 note in the singular', async () => {
    const { unmount } = show((target) => ({
      ...base(target),
      selfReview: { reviewed: 6, total: 6, notes: 2 },
    }));
    const notes = await checks();
    expect(notes.review).toHaveAttribute('data-state', 'ok');
    expect(within(notes.review).getByText('Self-review done')).toBeVisible();
    expect(within(notes.review).getByText('6 of 6 steps · 2 open notes')).toBeVisible();
    unmount();
    show((target) => ({ ...base(target), selfReview: { reviewed: 1, total: 1, notes: 1 } }));
    const single = await checks();
    expect(within(single.review).getByText('1 of 1 step · 1 open note')).toBeVisible();
  });

  it('F-27.5 an open MR of the branch shows a banner with the link and disables Create', async () => {
    const user = userEvent.setup();
    const { router } = show((target) => ({
      ...base(target),
      existingMr: { iid: 482, title: 'Enable compiled bindings' },
    }));
    const banner = await screen.findByRole('region', { name: 'Existing merge request' });
    expect(
      within(banner).getByText('This branch already has an open merge request.'),
    ).toBeVisible();
    expect(within(banner).getByText('Enable compiled bindings')).toBeVisible();
    const link = within(banner).getByRole('link', { name: '!482' });
    expect(link).toHaveAttribute('href', '/mr/482/author');
    expect(create()).toBeDisabled();
    await user.click(link);
    expect(router.state.location.pathname).toBe('/mr/482/author');
  });

  it('F-27.5 without an open MR there is no banner', async () => {
    renderApp({ screen: 'S-11' });
    await checks();
    expect(screen.queryByRole('region', { name: 'Existing merge request' })).toBeNull();
    expect(create()).toBeEnabled();
  });

  it('F-27.5 while the checks load the region is busy, shows no checks and Create is disabled', async () => {
    show(() => base(), { gitMergeCheck: () => new Promise<Check>(() => undefined) });
    const box = await region();
    expect(box).toHaveAttribute('aria-busy', 'true');
    expect(within(box).queryAllByRole('listitem')).toHaveLength(0);
    expect(create()).toBeDisabled();
  });

  it('F-27.5 when the checks fail the region says why and Create stays enabled', async () => {
    show(() => base(), {
      gitMergeCheck: () =>
        Promise.reject(
          new IpcError({
            code: 'GIT_FAILED',
            message: 'git ls-remote failed.',
            retryable: true,
          }),
        ),
    });
    const box = await region();
    expect(await within(box).findByRole('alert')).toHaveTextContent('git ls-remote failed.');
    expect(within(box).queryAllByRole('listitem')).toHaveLength(0);
    expect(create()).toBeEnabled();
  });
});
