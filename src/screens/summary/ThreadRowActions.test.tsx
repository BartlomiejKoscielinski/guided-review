import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IpcError } from '../../ipc/errors';
import {
  ANNA,
  MARTA,
  ME,
  OLA,
  QUEUE,
  SESSION,
  VM,
  XAML,
  expectFilters,
  openSummary,
  rowButton,
  rowNow,
  rowOf,
  thread,
} from '../../test/threadRows';

// F-13.2: Resolve and Reopen on a row of S-05's Threads tab (SummaryDesk.dc.html). An open row has
// the green Resolve, a resolved row the grey Reopen, never both. Each goes to GitLab at once
// through `gitlab_resolve` (M5 decision 13) - independent of drafts and approval, one click, no
// reply and no Claude - and the row changes only when GitLab has it, as the step's thread card does
// (M5 decision 2): the button is busy meanwhile, a failure keeps the row as it was and says why in
// the row. The list, the filters' numbers and the tab's "Threads N open" follow the answer.
//
// Decisions locked here (tests stage, M5 / F-13.2):
// - The failure line has the card's copy, as a role=alert inside the row: "Couldn't resolve the
//   thread. <reason>" and "Couldn't reopen the thread. <reason>" (decision 2 names the card; one
//   copy for one action is the consistent reading).
// - Under All the pressed button's successor takes the keyboard focus (Resolve -> Reopen, Reopen
//   -> Resolve), as on the card (F-11.2), so Tab does not restart from the top of the page.
// - Under Open or Resolved a row that no longer fits the filter leaves the list at once (the mock
//   derives the list from the threads, F-13.1); "No threads in this view." stands in if it was
//   the last.

const KICK_ID = 'd-1';
const KICK = 'Kick() is called on the UI thread. Does the worker block anything here?';
const TABLE = 'Is the table created on every start? CREATE TABLE IF NOT EXISTS would be enough.';
const BANNER = 'Banner color should come from resources, not be hardcoded.';
const FORBIDDEN = "GitLab doesn't allow this for your account.";

/** Two open threads and a resolved one: All, Open 2, Resolved 1. */
const trio = () => [
  thread({ id: KICK_ID, body: KICK, replies: [MARTA], at: { file: VM, line: 48 } }),
  thread({ id: 'd-2', body: TABLE, replies: [ANNA], at: { file: QUEUE, line: 24 } }),
  thread({
    id: 'd-3',
    body: BANNER,
    by: OLA,
    replies: [ME, OLA],
    resolved: true,
    at: { file: XAML, line: 22 },
  }),
];

const forbidden = () =>
  new IpcError({ code: 'GITLAB_FORBIDDEN', message: FORBIDDEN, retryable: false });

/** A promise the test settles by hand, to hold a call in flight. */
function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

describe('S-05 Threads tab Resolve and Reopen (F-13.2)', () => {
  it('F-13.2 an open row has Resolve and no Reopen, a resolved row has Reopen and no Resolve', async () => {
    await openSummary(trio());
    const open = await rowOf(KICK);
    expect(rowButton(open, 'Resolve')).toBeEnabled();
    expect(within(open).queryByRole('button', { name: 'Reopen' })).toBeNull();
    const done = await rowOf(BANNER);
    expect(rowButton(done, 'Reopen')).toBeEnabled();
    expect(within(done).queryByRole('button', { name: 'Resolve' })).toBeNull();
  });

  it('F-13.2 Resolve resolves the thread on GitLab at once: the row turns resolved with Reopen, the numbers follow, nothing else is sent', async () => {
    const user = userEvent.setup();
    const { client } = await openSummary(trio());
    const resolve = vi.spyOn(client, 'gitlabResolve');
    const reply = vi.spyOn(client, 'gitlabReply');
    await expectFilters(['All', 'Open 2', 'Resolved 1']);
    await user.click(rowButton(await rowOf(KICK), 'Resolve'));

    await within(await rowOf(KICK)).findByRole('button', { name: 'Reopen' });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(SESSION, KICK_ID, true);
    expect(reply).not.toHaveBeenCalled();
    const row = rowNow(KICK);
    expect(row).toHaveTextContent('· 1 reply · resolved · DeliveryPhotoViewModel.cs:48');
    expect(within(row).queryByRole('button', { name: 'Resolve' })).toBeNull();
    await expectFilters(['All', 'Open 1', 'Resolved 2']);
    expect(screen.getByRole('tab', { name: 'Threads 1 open' })).toBeInTheDocument();
    // The button that was pressed is gone: Reopen, its successor, has the keyboard focus.
    await waitFor(() => {
      expect(rowButton(rowNow(KICK), 'Reopen')).toHaveFocus();
    });
  });

  it('F-13.2 Reopen opens a resolved thread again: Resolve is back, "resolved" is gone, the numbers follow', async () => {
    const user = userEvent.setup();
    const { client } = await openSummary(trio());
    const resolve = vi.spyOn(client, 'gitlabResolve');
    await user.click(rowButton(await rowOf(BANNER), 'Reopen'));

    await within(await rowOf(BANNER)).findByRole('button', { name: 'Resolve' });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(SESSION, 'd-3', false);
    const row = rowNow(BANNER);
    expect(row).toHaveTextContent('Ola M. · 2 replies · DeliveryPhotoPage.xaml:22');
    expect(row).not.toHaveTextContent('resolved');
    expect(within(row).queryByRole('button', { name: 'Reopen' })).toBeNull();
    await expectFilters(['All', 'Open 3', 'Resolved 0']);
    expect(screen.getByRole('tab', { name: 'Threads 3 open' })).toBeInTheDocument();
    await waitFor(() => {
      expect(rowButton(rowNow(BANNER), 'Resolve')).toHaveFocus();
    });
  });

  it('F-13.2 while Resolve is in flight its button is disabled and the row does not claim "resolved" yet', async () => {
    const user = userEvent.setup();
    const held = gate();
    const { client } = await openSummary(trio());
    const real = client.gitlabResolve.bind(client);
    const resolve = vi.spyOn(client, 'gitlabResolve').mockImplementationOnce(async (...args) => {
      await held.opened;
      return real(...args);
    });
    await user.click(rowButton(await rowOf(KICK), 'Resolve'));

    await waitFor(() => {
      expect(rowButton(rowNow(KICK), 'Resolve')).toBeDisabled();
    });
    expect(rowNow(KICK)).not.toHaveTextContent('resolved');
    expect(within(rowNow(KICK)).queryByRole('button', { name: 'Reopen' })).toBeNull();
    await expectFilters(['All', 'Open 2', 'Resolved 1']);
    await user.click(rowButton(rowNow(KICK), 'Resolve'));
    expect(resolve).toHaveBeenCalledTimes(1);

    held.open();
    expect(await within(rowNow(KICK)).findByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(resolve).toHaveBeenCalledTimes(1);
    // Another row's Resolve was never held up.
    expect(rowButton(rowNow(TABLE), 'Resolve')).toBeEnabled();
  });

  it('F-13.2 a failed Resolve keeps the row open and says "Couldn\'t resolve the thread. <reason>" in the row; trying again works', async () => {
    const user = userEvent.setup();
    const { client } = await openSummary(trio());
    vi.spyOn(client, 'gitlabResolve').mockRejectedValueOnce(forbidden());
    await user.click(rowButton(await rowOf(KICK), 'Resolve'));

    const alert = await within(rowNow(KICK)).findByRole('alert');
    expect(alert).toHaveTextContent(`Couldn't resolve the thread. ${FORBIDDEN}`);
    expect(rowNow(KICK)).not.toHaveTextContent('resolved');
    expect(rowButton(rowNow(KICK), 'Resolve')).toBeEnabled();
    expect(within(rowNow(KICK)).queryByRole('button', { name: 'Reopen' })).toBeNull();
    await expectFilters(['All', 'Open 2', 'Resolved 1']);
    // Only the row the user acted on says it.
    expect(within(rowNow(TABLE)).queryByRole('alert')).toBeNull();

    await user.click(rowButton(rowNow(KICK), 'Resolve'));
    expect(await within(rowNow(KICK)).findByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(within(rowNow(KICK)).queryByRole('alert')).toBeNull();
  });

  it('F-13.2 a failed Reopen keeps the thread resolved and says "Couldn\'t reopen the thread. <reason>" in the row', async () => {
    const user = userEvent.setup();
    const { client } = await openSummary(trio());
    vi.spyOn(client, 'gitlabResolve').mockRejectedValueOnce(forbidden());
    await user.click(rowButton(await rowOf(BANNER), 'Reopen'));

    const alert = await within(rowNow(BANNER)).findByRole('alert');
    expect(alert).toHaveTextContent(`Couldn't reopen the thread. ${FORBIDDEN}`);
    expect(rowNow(BANNER)).toHaveTextContent('· 2 replies · resolved ·');
    expect(rowButton(rowNow(BANNER), 'Reopen')).toBeEnabled();
    await expectFilters(['All', 'Open 2', 'Resolved 1']);
  });

  it('F-13.2 under Open a resolved row leaves the list and under Resolved a reopened one does, with "No threads in this view." for the last', async () => {
    const user = userEvent.setup();
    await openSummary(trio());
    await user.click(await screen.findByRole('button', { name: 'Open 2' }));
    expect(screen.queryByText(BANNER)).toBeNull();
    await user.click(rowButton(await rowOf(KICK), 'Resolve'));

    await waitFor(() => {
      expect(screen.queryByText(KICK)).toBeNull();
    });
    expect(screen.getByText(TABLE)).toBeInTheDocument();
    await expectFilters(['All', 'Open 1', 'Resolved 2']);
    expect(screen.getByRole('button', { name: 'Open 1' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Resolved 2' }));
    expect(await screen.findByText(KICK)).toBeInTheDocument();
    await user.click(rowButton(rowNow(KICK), 'Reopen'));
    await waitFor(() => {
      expect(screen.queryByText(KICK)).toBeNull();
    });
    await user.click(rowButton(rowNow(BANNER), 'Reopen'));
    expect(await screen.findByText('No threads in this view.')).toBeInTheDocument();
  });
});
