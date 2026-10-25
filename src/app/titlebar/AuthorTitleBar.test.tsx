import { act, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import { recordingClient, renderApp } from '../../test/renderApp';
import { pathFor } from '../routes';

// F-26.1: S-10's title bar shows "You’re the author" and the pipeline status of the MR as the
// core reads it (`authorMr(project, iid)`), not the example value of the design mock. The status
// chip is a link to S-08 (F-20.10) named "Pipeline passed" / "Pipeline running" / "Pipeline
// failed" / "No pipeline"; its square is green when passed and blue while running. While the MR
// loads, after a failed read and on a restored start (F-30.4: nothing is read) there is no chip.
//
// Locators the title bar keeps: data-testid "title-bar"; the tag text "You’re the author"; the
// chip as a link whose accessible name is the status words; its square an aria-hidden element
// with data-color inside the link.

const PROJECT = 'mobile/mobile-app';
const IID = 480;

type AuthorMr = Awaited<ReturnType<IpcClient['authorMr']>>;

const bar = () => within(screen.getByTestId('title-bar'));

async function openAuthor(over: Partial<AuthorMr> | 'pending' = {}) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const mr = await base.authorMr(PROJECT, IID);
  const authorMr = vi.fn(() =>
    over === 'pending'
      ? new Promise<AuthorMr>(() => undefined)
      : Promise.resolve({ ...mr, ...over }),
  );
  const rec = recordingClient({ ...base, authorMr });
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: IID })));
  return { ...app, ...rec, mr, authorMr };
}

describe('S-10 title bar (F-26.1)', () => {
  it('F-26.1 shows the repository, !480, the title and the tag "You’re the author"', async () => {
    await openAuthor();

    expect(await bar().findByText('Pipeline passed')).toBeInTheDocument();
    expect(bar().getByText('mobile-app')).toBeInTheDocument();
    expect(bar().getByText('!480')).toBeInTheDocument();
    expect(bar().getByText('Retry in UploadWorker after network loss')).toBeInTheDocument();
    expect(bar().getByText('You’re the author')).toBeInTheDocument();
  });

  it('F-26.1 the passed pipeline is a green "Pipeline passed" link to S-08 of !480', async () => {
    await openAuthor();

    const link = await bar().findByRole('link', { name: 'Pipeline passed' });
    expect(link).toHaveAttribute('href', '/mr/480/pipeline');
    expect(link.querySelector('[data-color="green"]')).not.toBeNull();
  });

  it('F-26.1 a running pipeline reads "Pipeline running" with a blue square, not the example value', async () => {
    const base = createMockClient({ latencyMs: 0 });
    await base.repoPick();
    const mr = await base.authorMr(PROJECT, IID);
    if (!mr.pipeline) throw new Error('the mock MR has a pipeline');
    await openAuthor({ pipeline: { ...mr.pipeline, status: 'running' } });

    const link = await bar().findByRole('link', { name: 'Pipeline running' });
    expect(link.querySelector('[data-color="blue"]')).not.toBeNull();
    expect(bar().queryByText('Pipeline passed')).toBeNull();
  });

  it('F-26.1 a failed pipeline reads "Pipeline failed"', async () => {
    const base = createMockClient({ latencyMs: 0 });
    await base.repoPick();
    const mr = await base.authorMr(PROJECT, IID);
    if (!mr.pipeline) throw new Error('the mock MR has a pipeline');
    await openAuthor({ pipeline: { ...mr.pipeline, status: 'failed' } });

    expect(await bar().findByRole('link', { name: 'Pipeline failed' })).toHaveAttribute(
      'href',
      '/mr/480/pipeline',
    );
  });

  it('F-26.1 an MR without a pipeline reads "No pipeline" and still opens S-08', async () => {
    await openAuthor({ pipeline: null });

    expect(await bar().findByRole('link', { name: 'No pipeline' })).toHaveAttribute(
      'href',
      '/mr/480/pipeline',
    );
    expect(bar().queryByText('Pipeline passed')).toBeNull();
  });

  it('F-26.1 while the MR loads the tag is there and no pipeline chip is', async () => {
    const { authorMr } = await openAuthor('pending');

    expect(await bar().findByText('You’re the author')).toBeInTheDocument();
    expect(authorMr).toHaveBeenCalled();
    expect(bar().queryByRole('link', { name: /pipeline/i })).toBeNull();
  });

  it('F-26.1 a restored start reads nothing: the tag and !480 stay, the chip does not', async () => {
    const base = createMockClient({ latencyMs: 0 });
    await base.repoPick();
    const rec = recordingClient(base);
    renderApp({ screen: 'S-10', iid: IID }, rec.client);

    expect(await bar().findByText('You’re the author')).toBeInTheDocument();
    expect(bar().getByText('!480')).toBeInTheDocument();
    expect(bar().queryByRole('link', { name: /pipeline/i })).toBeNull();
    expect(rec.calls).not.toContain('authorMr');
  });
});
