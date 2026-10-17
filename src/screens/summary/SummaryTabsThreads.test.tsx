import { act, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { App } from '../../app/App';
import { createQueryClient } from '../../app/queryClient';
import { createAppRouter } from '../../app/router';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { IpcProvider } from '../../ipc/IpcProvider';
import { createMockClient } from '../../ipc/mock';
import type { Thread } from '../../ipc/types/Thread';

// F-12.2: what "Threads N open" counts and what it says when GitLab can't answer. N is the open
// threads: resolvable and not resolved (a comment on the MR itself can't be resolved, so it is
// never open). A count that isn't known is left out, never claimed as "Threads 0 open".

const MR_SESSION = 'mock-mr-session-1';

async function openSummary(overrides: Partial<IpcClient>) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  await base.reviewPlan(MR_SESSION, () => undefined);
  const router = createAppRouter({ screen: 'S-01' });
  render(
    <IpcProvider client={{ ...base, ...overrides }}>
      <QueryClientProvider client={createQueryClient()}>
        <App router={router} />
      </QueryClientProvider>
    </IpcProvider>,
  );
  await act(() => router.navigate(`/session/${MR_SESSION}/summary`));
}

const thread = (id: string, resolvable: boolean, resolved: boolean): Thread => ({
  id,
  resolvable,
  resolved,
  notes: [],
  outdated: false,
});

describe('S-05 Threads N open (F-12.2)', () => {
  it('F-12.2 only resolvable threads that are not resolved count as open', async () => {
    const threads = [
      thread('d-1', true, false),
      thread('d-2', true, true),
      thread('d-3', false, false),
      thread('d-4', true, false),
    ];
    await openSummary({ gitlabDiscussions: () => Promise.resolve(threads) });
    expect(await screen.findByRole('tab', { name: 'Threads 2 open' })).toBeInTheDocument();
  });

  it('F-12.2 when GitLab cannot be read the tab says a bare "Threads", never "Threads 0 open"', async () => {
    const failure = new IpcError({
      code: 'GITLAB_UNREACHABLE',
      message: "GitLab can't be reached.",
      retryable: true,
    });
    await openSummary({ gitlabDiscussions: () => Promise.reject(failure) });
    const threads = await screen.findByRole('tab', { name: 'Threads' });
    expect(threads).toHaveAttribute('aria-selected', 'true');
    // The failed read has settled: the drafts tab is there, and no count is claimed.
    expect(await screen.findByRole('tab', { name: 'Drafts 0' })).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(screen.queryByRole('tab', { name: /open$/ })).toBeNull();
  });
});
