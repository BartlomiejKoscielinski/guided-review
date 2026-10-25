import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IpcClient } from '../../ipc/client';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';

// F-20.10 on S-01 (M6 decision 16): the pipeline status of an MR row is its own link to S-08,
// a sibling of the row's open button (a link inside a button is invalid HTML and unreachable by
// keyboard). Clicking it opens S-08 and prepares no review.

const column = () => within(screen.getByRole('region', { name: 'Merge requests' }));

function renderStart(overrides: Partial<IpcClient> = {}) {
  const ipc = mockClient(overrides);
  return renderApp({ screen: 'S-01' }, ipc);
}

/** The first pipeline link with this name in the column; throws when there is none. */
async function pipelineLink(name: 'pipeline failed' | 'pipeline passed'): Promise<HTMLElement> {
  const first = (await column().findAllByRole('link', { name })).at(0);
  if (!first) throw new Error(`No link “${name}”`);
  return first;
}

describe('S-01 pipeline link', () => {
  it('F-20.10 every row with a pipeline shows its status as a link to S-08 of that merge request', async () => {
    const listed = await mockClient().gitlabListMrs('waiting');
    renderStart();
    await column().findByText('Migrate to .NET 10');
    const links = column().getAllByRole('link', { name: /^pipeline (passed|failed|running)$/ });
    const hrefs = links.map((l) => l.getAttribute('href')).sort();
    const expected = listed.rows.map((r) => `/mr/${String(r.iid)}/pipeline`).sort();
    expect(expected.length).toBeGreaterThan(1);
    expect(hrefs).toEqual(expected);
  });

  it('F-20.10 the pipeline link keeps the status square and words and is not inside the open button', async () => {
    renderStart();
    const failed = await pipelineLink('pipeline failed');
    expect(failed).toHaveAttribute('href', '/mr/475/pipeline');
    expect(failed.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(failed.closest('button')).toBeNull();
    const open = column().getByText('Migrate to .NET 10').closest('button');
    expect(open).not.toBeNull();
    expect(open?.querySelector('a')).toBeNull();
    expect(open).not.toHaveTextContent('pipeline failed');
  });

  it('F-20.10 clicking the pipeline link opens S-08 and does not prepare a review', async () => {
    const user = userEvent.setup();
    const sessionOpenMr = vi.fn();
    const { router } = renderStart({
      sessionOpenMr: () => {
        sessionOpenMr();
        return Promise.reject(new Error('no review'));
      },
    });
    await user.click(await pipelineLink('pipeline failed'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/mr/475/pipeline');
    });
    expect(sessionOpenMr).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { level: 1, name: 'Pipeline' })).toBeInTheDocument();
  });

  it('F-20.10 the row still opens the merge request when clicked outside the pipeline link', async () => {
    const user = userEvent.setup();
    const sessionOpenMr = vi.fn();
    renderStart({
      sessionOpenMr: () => {
        sessionOpenMr();
        return Promise.resolve({ sessionId: 'mr-1', route: { screen: 'S-02', sessionId: 'mr-1' } });
      },
    });
    await pipelineLink('pipeline failed');
    await user.click(await column().findByText('Migrate to .NET 10'));
    await waitFor(() => {
      expect(sessionOpenMr).toHaveBeenCalledTimes(1);
    });
  });

  it('F-20.10 opened from a row, S-08 reads "Back to MRs" and returns to S-01', async () => {
    const user = userEvent.setup();
    const { router } = renderStart();
    await user.click(await pipelineLink('pipeline failed'));
    await user.click(await screen.findByRole('link', { name: 'Back to MRs' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    expect(await column().findByText('Migrate to .NET 10')).toBeInTheDocument();
  });

  it('F-20.10 the pipeline link is reachable by keyboard and Enter opens S-08', async () => {
    const user = userEvent.setup();
    renderStart();
    const failed = await pipelineLink('pipeline failed');
    expect(failed).not.toHaveAttribute('tabindex', '-1');
    failed.focus();
    expect(failed).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: 'Pipeline' })).toBeInTheDocument();
  });
});
