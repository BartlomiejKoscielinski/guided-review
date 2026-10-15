import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import type { ReviewScenario } from '../../ipc/mock/review';
import type { PlanView } from '../../ipc/types/PlanView';
import type { SessionMr } from '../../ipc/types/SessionMr';
import type { StepAnalysis } from '../../ipc/types/StepAnalysis';
import { renderApp } from '../../test/renderApp';

const TITLE = 'Offline queue for delivery photos';
const SESSION: SessionMr = {
  mr: {
    iid: 482,
    title: TITLE,
    author: 'Marta K.',
    sourceBranch: 'feature/offline-upload',
    targetBranch: 'develop',
    pipeline: 'passed',
  },
  groups: [],
  totalFiles: 16,
  additions: 462,
  deletions: 61,
  commits: 3,
};
const sessionMr = () => Promise.resolve(SESSION);

/** The mock backend's plan commands for a scenario (no latency). */
const planOf = (review: ReviewScenario = {}): Partial<IpcClient> => {
  const mock = createMockClient({ latencyMs: 0, review });
  return {
    reviewPlan: (sessionId, onEvent) => mock.reviewPlan(sessionId, onEvent),
    reviewSetStrategy: (sessionId, strategy) => mock.reviewSetStrategy(sessionId, strategy),
    reviewReorderSteps: (sessionId, stepIds) => mock.reviewReorderSteps(sessionId, stepIds),
  };
};

/** Step 1's analysis stays running until the test ends it. */
function pendingFindings() {
  let finish: (a: StepAnalysis) => void = () => undefined;
  const reviewFindings = vi.fn<IpcClient['reviewFindings']>(
    () =>
      new Promise<StepAnalysis>((resolve) => {
        finish = resolve;
      }),
  );
  return {
    reviewFindings,
    finish: (a: StepAnalysis) => {
      finish(a);
    },
  };
}

const open = (client: Partial<IpcClient>) =>
  renderApp({ screen: 'S-02', sessionId: 's1' }, { sessionMr, ...planOf(), ...client });
const titleBar = () => screen.getByTestId('title-bar');

describe('S-02 PlanPrepared', () => {
  it('F-06.1 F-06.2 header, then Claude’s intent under the purple square', async () => {
    open({});
    expect(await screen.findByRole('heading', { level: 1, name: TITLE })).toBeInTheDocument();
    expect(screen.getByText('feature/offline-upload → develop')).toBeInTheDocument();
    const intent = (await screen.findByRole('heading', { name: 'What this change does' })).closest(
      'section',
    ) as HTMLElement;
    expect(intent.querySelector('[data-color="purple"]')).not.toBeNull();
    expect(await within(intent).findByText('UploadWorker')).toHaveProperty('tagName', 'CODE');
    expect(screen.getByRole('heading', { name: 'Plan · 8 steps' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Plan details' })).toBeInTheDocument();
  });

  it('F-06.12 Planning: the placeholder, Start step 1 waits, the title bar says so', async () => {
    const reviewPlan = vi.fn<IpcClient['reviewPlan']>((_s, onEvent) => {
      onEvent({ kind: 'queued' });
      onEvent({ kind: 'started' });
      return new Promise<PlanView>(() => undefined);
    });
    open({ reviewPlan });
    expect(
      await screen.findByText('Claude is planning · usually under a minute'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start step 1/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Browse files instead' })).toBeEnabled();
    expect(await within(titleBar()).findByText('Claude is planning')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Plan · / })).not.toBeInTheDocument();
  });

  it('F-06.12 plan ready: step 1 is analyzed and the title bar shows it', async () => {
    const findings = pendingFindings();
    open({ reviewFindings: findings.reviewFindings });
    expect(
      await within(titleBar()).findByText('Plan ready · Claude is analyzing step 1'),
    ).toBeInTheDocument();
    expect(findings.reviewFindings).toHaveBeenCalledWith('s1', 's1', expect.any(Function));
    findings.finish({ stepId: 's1', findings: [], checklist: [], filesRead: [], folds: [] });
    expect(await within(titleBar()).findByText('Plan ready')).toBeInTheDocument();
  });

  it('F-06.12 Cached: everything at once, "Plan from cache · <age>"', async () => {
    open(planOf({ planCached: true }));
    expect(await within(titleBar()).findByText(/^Plan from cache · /)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Plan · 8 steps' })).toBeInTheDocument();
  });

  it('F-06.4 Claude failed: the file-order fallback with the banner and Retry', async () => {
    const plan = planOf({ planFails: true });
    const reviewPlan = vi.fn(plan.reviewPlan);
    open({ ...plan, reviewPlan });
    const banner = await screen.findByRole('status', { name: "Claude isn't available" });
    expect(banner).toHaveTextContent("Claude isn't available. You can review in file order.");
    expect(banner).toHaveTextContent('Claude Code failed.');
    expect(
      screen.queryByRole('heading', { name: 'What this change does' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Plan · 8 steps' })).toBeInTheDocument();
    expect(within(titleBar()).getByText("Claude isn't available")).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Risks to check' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Already discussed' })).toBeInTheDocument();
    await userEvent.click(within(banner).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(reviewPlan).toHaveBeenCalledTimes(2);
    });
  });

  it('F-06.9 the aside’s Already discussed is Claude’s summary of the existing threads', async () => {
    open({});
    const heading = await screen.findByRole('heading', { name: 'Already discussed' });
    expect(heading.closest('section')).toHaveTextContent(
      '3 open threads from Paweł S. in steps 2 and 4.',
    );
  });

  it('F-06.9 without Claude the aside says "N open threads." from the discussions count', async () => {
    open(planOf({ planFails: true }));
    const heading = await screen.findByRole('heading', { name: 'Already discussed' });
    const discussed = heading.closest('section') as HTMLElement;
    expect(within(discussed).getByText('3 open threads.', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(/Paweł S\./)).not.toBeInTheDocument();
  });

  it('F-06.4 the toggle reorders through the backend', async () => {
    open({});
    await userEvent.click(await screen.findByRole('radio', { name: 'Tests first' }));
    await waitFor(() => {
      const first = screen.getAllByRole('listitem').find((li) => li.dataset.step);
      expect(first).toHaveTextContent('Queue tests');
    });
    expect(
      screen.getByText('Tests first: read them as the spec, then the implementation.'),
    ).toBeInTheDocument();
  });

  it('F-06.11 Enter starts step 1; Browse files instead opens the MR files', async () => {
    const { router } = open({});
    await screen.findByRole('heading', { name: 'Plan · 8 steps' });
    await userEvent.click(screen.getByRole('heading', { level: 1, name: TITLE }));
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(pathFor({ screen: 'S-03', sessionId: 's1' }));
    });
    await router.navigate(pathFor({ screen: 'S-02', sessionId: 's1' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Browse files instead' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(pathFor({ screen: 'S-06', sessionId: 's1' }));
    });
  });

  it('F-06.11 Enter on a drag handle does not start step 1', async () => {
    const { router } = open({});
    const handle = await screen.findByRole('button', { name: 'Move step: Queue contract' });
    handle.focus();
    await userEvent.keyboard('{Enter}');
    expect(router.state.location.pathname).toBe(pathFor({ screen: 'S-02', sessionId: 's1' }));
  });
});
