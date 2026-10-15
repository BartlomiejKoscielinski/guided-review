import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import { groupFiles } from '../../ipc/mock/changes';
import {
  MOCK_ORDERS,
  MOCK_SKIM_FILES,
  MOCK_STEP_STATS,
  mockPlan,
} from '../../ipc/mock/fixtures/plan';
import { lineCounts, mrFiles } from '../../ipc/mock/fixtures/mr';
import type { PlanView } from '../../ipc/types/PlanView';
import type { SessionMr } from '../../ipc/types/SessionMr';
import type { TreeFile } from '../../ipc/types/TreeFile';
import { renderApp } from '../../test/renderApp';

// F-06.6 on S-02: Show opens the S-06-like browse of the MR (M3 plan: "lists the files; opens the
// S-06-like browse filtered to them") with only the files of that skim row. jsdom has no layout, so
// the virtualized tree draws no rows there: the filter count of the tree panel stands in for the
// rows, and tests/e2e/plan.spec.ts checks the rows themselves.

const SESSION_ID = 's1';
const files: TreeFile[] = mrFiles().map((file) => ({
  path: file.path,
  name: file.path.split('/').pop() ?? file.path,
  oldPath: file.oldPath,
  status: file.status,
  binary: false,
  ...lineCounts(file),
  untracked: false,
}));
const SESSION: SessionMr = {
  mr: {
    iid: 482,
    title: 'Offline queue for delivery photos',
    author: 'Marta K.',
    sourceBranch: 'feature/offline-upload',
    targetBranch: 'develop',
    pipeline: 'passed',
  },
  groups: groupFiles(files),
  totalFiles: files.length,
  additions: 462,
  deletions: 61,
  commits: 3,
};
const sessionMr = () => Promise.resolve(SESSION);

/** The mock backend's plan commands (no latency). */
function planClient(): Pick<IpcClient, 'reviewPlan' | 'reviewSetStrategy' | 'reviewReorderSteps'> {
  const mock = createMockClient({ latencyMs: 0 });
  return {
    reviewPlan: vi.fn<IpcClient['reviewPlan']>((id, onEvent) => mock.reviewPlan(id, onEvent)),
    reviewSetStrategy: (id, strategy) => mock.reviewSetStrategy(id, strategy),
    reviewReorderSteps: (id, stepIds) => mock.reviewReorderSteps(id, stepIds),
  };
}

/** !482's plan with two skim rows: the first three skim files, then the last two. */
function twoSkimGroups(): PlanView {
  const plan = mockPlan();
  const reason = plan.skim[0]?.reason ?? '';
  return {
    plan: {
      ...plan,
      skim: [
        { hunkIds: ['skim-a#h1'], reason },
        { hunkIds: ['skim-b#h1'], reason: 'Generated resource keys. Checked: no logic changes.' },
      ],
    },
    order: { strategy: 'contractToUi', custom: false, order: MOCK_ORDERS.contractToUi },
    stepStats: MOCK_STEP_STATS,
    skimStats: [
      { files: 3, additions: 60, deletions: 2 },
      { files: 2, additions: 10, deletions: 9 },
    ],
    skimFiles: [MOCK_SKIM_FILES.slice(0, 3), MOCK_SKIM_FILES.slice(3)],
    reviewed: [],
  };
}

const matching = () => screen.getByLabelText('Matching files');

describe('S-02 skim row Show', () => {
  it('F-06.6 Show opens the MR browse with only the skim row’s files, without planning again', async () => {
    const plan = planClient();
    renderApp({ screen: 'S-02', sessionId: SESSION_ID }, { sessionMr, ...plan });
    expect(await screen.findByText('Skim: 5 mechanical files')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show' }));

    const tree = await screen.findByRole('navigation', { name: 'Changed files' });
    expect(within(tree).getByLabelText('Matching files')).toHaveTextContent(/^5$/);
    // The browse reads the plan the screen already has: no second plan task, no Claude.
    expect(plan.reviewPlan).toHaveBeenCalledTimes(1);
  });

  it('F-06.6 each skim row shows its own files', async () => {
    const view = twoSkimGroups();
    const reviewPlan: IpcClient['reviewPlan'] = (_id, onEvent) => {
      onEvent({ kind: 'queued' });
      onEvent({ kind: 'done', result: view });
      return Promise.resolve(view);
    };
    renderApp(
      { screen: 'S-02', sessionId: SESSION_ID },
      { sessionMr, ...planClient(), reviewPlan },
    );
    expect(await screen.findByText('Skim: 3 mechanical files')).toBeInTheDocument();
    expect(screen.getByText('Skim: 2 mechanical files')).toBeInTheDocument();
    expect(
      screen.getByText('Generated resource keys. Checked: no logic changes.'),
    ).toBeInTheDocument();

    const second = screen.getByText('Skim: 2 mechanical files').closest('li') as HTMLElement;
    await userEvent.click(within(second).getByRole('button', { name: 'Show' }));
    await screen.findByRole('navigation', { name: 'Changed files' });
    expect(matching()).toHaveTextContent(/^2$/);
  });

  it('F-06.6 Browse files instead after Show lists the whole change again', async () => {
    const { router } = renderApp(
      { screen: 'S-02', sessionId: SESSION_ID },
      { sessionMr, ...planClient() },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Show' }));
    await screen.findByRole('navigation', { name: 'Changed files' });
    expect(matching()).toHaveTextContent(/^5$/);

    await router.navigate(pathFor({ screen: 'S-02', sessionId: SESSION_ID }));
    await userEvent.click(await screen.findByRole('button', { name: 'Browse files instead' }));
    await screen.findByRole('navigation', { name: 'Changed files' });
    await waitFor(() => {
      expect(matching()).toHaveTextContent(/^16$/);
    });
  });
});
