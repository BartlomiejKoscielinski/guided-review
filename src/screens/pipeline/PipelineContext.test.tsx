import { act, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-20.1: S-08's title-bar context (plan M6: repository, !iid, title) and the copy the spec and
// the mock don't give (P-017): an active repository without a GitLab project.

const IID = 482;

async function openPipeline(override: Partial<IpcClient> = {}, waitFor?: string) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const rec = recordingClient({ ...base, ...override });
  const app = renderApp({ screen: 'S-01' }, rec.client);
  // The user opens the pipeline from a row S-01 already shows.
  if (waitFor !== undefined) await screen.findByText(waitFor);
  await act(() => app.router.navigate(pathFor({ screen: 'S-08', iid: IID })));
  return { ...app, ...rec, base };
}

describe('S-08 title bar and project (F-20.1)', () => {
  it('F-20.1 the title bar names the repository, !482 and the MR title S-01 read', async () => {
    await openPipeline({}, 'Offline queue for delivery photos');

    await screen.findByTestId('pipeline-status');
    const bar = within(screen.getByTestId('title-bar'));
    expect(await bar.findByText('mobile-app')).toBeInTheDocument();
    expect(bar.getByText('!482')).toBeInTheDocument();
    expect(await bar.findByText('Offline queue for delivery photos')).toBeInTheDocument();
  });

  it('F-20.1 an active repository without a GitLab project says so and reads no pipeline', async () => {
    const base = createMockClient({ latencyMs: 0 });
    await base.repoPick();
    const repos = await base.repoList();
    const { calls } = await openPipeline({
      repoList: () => Promise.resolve(repos.map((r) => ({ ...r, gitlabProject: undefined }))),
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The active repository has no GitLab project.',
    );
    expect(screen.queryByText('No pipeline for this MR yet.')).toBeNull();
    expect(calls).not.toContain('pipelineList');
  });
});
