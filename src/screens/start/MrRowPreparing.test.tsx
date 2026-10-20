import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';

// F-20.10 (autopilot decision): while S-01 prepares a review, the MR rows are inert, and so are
// their pipeline links: the status stays visible as words, without a link to S-08.

const column = () => within(screen.getByRole('region', { name: 'Merge requests' }));

describe('S-01 pipeline link while a review is being prepared', () => {
  it('F-20.10 the pipeline status is not a link while a review opens, and is one again after it fails', async () => {
    const user = userEvent.setup();
    let fail: (reason: Error) => void = () => undefined;
    renderApp(
      { screen: 'S-01' },
      mockClient({
        sessionOpenMr: () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      }),
    );
    await column().findAllByRole('link', { name: 'pipeline passed' });
    await user.click(column().getByText('Migrate to .NET 10'));
    await waitFor(() => {
      expect(column().queryAllByRole('link', { name: /^pipeline / })).toHaveLength(0);
    });
    expect(column().getByText('pipeline failed')).toBeInTheDocument();
    expect(column().getByText('Migrate to .NET 10').closest('button')).toBeDisabled();
    fail(new Error('no review'));
    expect(await column().findByRole('link', { name: 'pipeline failed' })).toHaveAttribute(
      'href',
      '/mr/475/pipeline',
    );
  });

  it('F-20.10 a review opened from the source input makes the pipeline statuses plain words too', async () => {
    const user = userEvent.setup();
    renderApp(
      { screen: 'S-01' },
      mockClient({ sessionOpenMr: () => new Promise(() => undefined) }),
    );
    await column().findAllByRole('link', { name: 'pipeline passed' });
    await user.type(screen.getByLabelText(/Paste a merge request link/), '!482');
    expect(await screen.findByText('Merge request !482')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(column().queryAllByRole('link', { name: /^pipeline / })).toHaveLength(0);
    });
    expect(column().getAllByText('pipeline passed').length).toBeGreaterThan(0);
  });
});
