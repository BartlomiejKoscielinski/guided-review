import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import type { DiffPosition } from '../../ipc/types/DiffPosition';
import { renderApp } from '../../test/renderApp';

// F-12.5, M5 decision 10b on S-05: the MR has a new version since the review and the line of the
// second draft is gone from it (mock knobs `mrChanged`, `linesGone`). Publish sends the others; the
// second one fails "the line is no longer in the MR", gets the OUTDATED tag, is unticked and says
// its line changed. Ticked again, Retry sends it (as a general comment in the core).

const MR_SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const SINGLE = 'The author got a single notification.';
const at = (line: number): DiffPosition => ({ file: VM, side: 'new', line });

async function backend(): Promise<IpcClient> {
  const base = createMockClient({ latencyMs: 0, gitlab: { mrChanged: true, linesGone: [2] } });
  await base.repoPick();
  await base.reviewPlan(MR_SESSION, () => undefined);
  for (const [n, line] of [54, 49, 60].entries()) {
    await base.draftsCreate({
      sessionId: MR_SESSION,
      findingId: null,
      severity: 'q',
      body: `Comment ${String(n + 1)}`,
      position: at(line),
    });
  }
  return { ...base };
}

const rowAt = (n: number): HTMLElement => {
  const row = within(screen.getByRole('tabpanel')).getAllByRole('listitem')[n - 1];
  if (!row) throw new Error(`The list has no row ${String(n)}.`);
  return row;
};
const boxOf = (n: number) =>
  within(rowAt(n)).getByRole('checkbox', { name: `Publish comment ${String(n)}` });

describe('S-05 Publish on a new MR version (F-12.5, M5 decision 10b)', () => {
  it('F-12.5 a draft whose line is gone is held back, tagged Outdated and unticked; ticked, Retry sends it', async () => {
    const app = renderApp({ screen: 'S-01' }, await backend());
    await act(() => app.router.navigate(`/session/${MR_SESSION}/summary`));
    await within(await screen.findByRole('tabpanel')).findAllByRole('listitem');

    await userEvent.click(screen.getByRole('button', { name: 'Publish (3)' }));

    await screen.findByText('Published 2 of 3. 1 failed: the line is no longer in the MR.');
    expect(await within(rowAt(2)).findByText(/^outdated$/i)).toBeInTheDocument();
    expect(rowAt(2)).toHaveTextContent('line changed, published as a general comment');
    expect(boxOf(2)).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();

    await userEvent.click(boxOf(2));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    await screen.findByText(`Published 1 comment. ${SINGLE}`);
  });
});
