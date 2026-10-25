import { describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';
import { pathFor } from '../routes';

// F-20.10 on S-10: the title bar's pipeline chip ("Pipeline passed", the head pipeline of !480 as
// `authorMr` reads it since F-26.1) links to S-08 of the route's merge request; S-08's back link
// returns to S-10. S-10 is opened by navigation: a restored start reads no pipeline (F-30.4).

async function openAuthor() {
  const app = renderApp({ screen: 'S-01' }, mockClient());
  await act(() => app.router.navigate(pathFor({ screen: 'S-10', iid: 480 })));
  return app;
}

const bar = () => within(screen.getByTestId('title-bar'));

describe('S-10 title bar pipeline link', () => {
  it('F-20.10 the chip "Pipeline passed" is a link to S-08 of the merge request', async () => {
    await openAuthor();
    const link = await bar().findByRole('link', { name: 'Pipeline passed' });
    expect(link).toHaveAttribute('href', '/mr/480/pipeline');
  });

  it('F-20.10 clicking it opens S-08 and "Back to review" returns to S-10', async () => {
    const user = userEvent.setup();
    const { router } = await openAuthor();
    await user.click(await bar().findByRole('link', { name: 'Pipeline passed' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/mr/480/pipeline');
    });
    await user.click(await screen.findByRole('link', { name: 'Back to review' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/mr/480/author');
    });
  });
});
