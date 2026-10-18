import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  MARTA,
  OLA,
  QUEUE,
  SESSION,
  VM,
  WORKER,
  openSummary,
  rowButton,
  rowOf,
  thread,
  type Opened,
} from '../../test/threadRows';

// F-13.2: Show in code on a row of S-05's Threads tab (SummaryDesk.dc.html: the square link with
// the brackets icon, left of Resolve / Reopen, aria-label "Show in code: <file:line>", title
// "Show in code"). It opens the step the thread shows in (M5 decision 4: its line, else the file
// header of the first step in the current order that shows the file), in the session's mode
// (Focus: /step, Detailed: /detailed), on `?step=<id>`; it is hidden for a thread that shows in no
// step (a file that is no longer in the MR) and for a comment on the MR itself (decision 13). The
// card is scrolled into view by the screen; that part is covered in tests/e2e/summary-f13-2.spec.ts.
//
// Locators the rows keep: the link is found by its aria-label "Show in code: <file:line>" (the
// same text as the row's location) and carries the title "Show in code"; it is keyboard reachable
// and comes before Resolve / Reopen in the row. The step is the `step` search parameter of the
// opened location; extra parameters or location state (for the scroll) are free.
//
// Not locked (the spec leaves them to the screen): a thread in a skim file (DeliveryPhotoPage.xaml
// is in no step of the mock plan) and an OUTDATED thread's target line.

const KICK = 'Kick() is called on the UI thread. Does the worker block anything here?';
const TABLE = 'Is the table created on every start? CREATE TABLE IF NOT EXISTS would be enough.';
const RETRY = 'Retries have no upper limit on a permanent 4xx.';
const GONE = 'This file was deleted from the MR but the thread stays.';
const GENERAL = 'Thanks for the quick turnaround on this one.';

const KICK_LABEL = 'Show in code: DeliveryPhotoViewModel.cs:48';

const where = ({ router }: Opened) => ({
  path: router.state.location.pathname,
  step: new URLSearchParams(router.state.location.search).get('step'),
});

/** Lets the rows settle, so that a link which should not appear has had its time to. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

describe('S-05 Threads tab Show in code (F-13.2)', () => {
  it('F-13.2 a row has Show in code before its Resolve: a keyboard-reachable link named "Show in code: file:line" with the title "Show in code"', async () => {
    await openSummary([thread({ id: 'd-1', body: KICK, at: { file: VM, line: 48 } })]);
    const row = await rowOf(KICK);
    const link = await within(row).findByLabelText(KICK_LABEL);
    expect(link).toHaveAttribute('title', 'Show in code');
    link.focus();
    expect(link).toHaveFocus();
    const resolve = rowButton(row, 'Resolve');
    expect(link.compareDocumentPosition(resolve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // It is a way to the code, not an action on the thread.
    expect(link).not.toHaveAttribute('disabled');
  });

  it('F-13.2 Show in code opens the step the thread shows in: the ViewModel thread opens step s4, and nothing is sent to GitLab', async () => {
    const user = userEvent.setup();
    const opened = await openSummary([
      thread({ id: 'd-1', body: KICK, replies: [MARTA], at: { file: VM, line: 48 } }),
      thread({ id: 'd-2', body: TABLE, at: { file: QUEUE, line: 24 } }),
    ]);
    const resolve = vi.spyOn(opened.client, 'gitlabResolve');
    await user.click(await screen.findByLabelText(KICK_LABEL));
    await waitFor(() => {
      expect(where(opened)).toEqual({ path: `/session/${SESSION}/step`, step: 's4' });
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('F-13.2 Show in code on a thread of SqliteUploadQueue opens step s2', async () => {
    const user = userEvent.setup();
    const opened = await openSummary([
      thread({ id: 'd-1', body: KICK, at: { file: VM, line: 48 } }),
      thread({ id: 'd-2', body: TABLE, at: { file: QUEUE, line: 24 } }),
    ]);
    await user.click(await screen.findByLabelText('Show in code: SqliteUploadQueue.cs:24'));
    await waitFor(() => {
      expect(where(opened)).toEqual({ path: `/session/${SESSION}/step`, step: 's2' });
    });
  });

  it("F-13.2 a thread on a line outside the step's hunks opens the first step that shows its file, on the file header", async () => {
    const user = userEvent.setup();
    const opened = await openSummary([
      thread({ id: 'd-1', body: RETRY, by: OLA, at: { file: WORKER, line: 500 } }),
    ]);
    await user.click(await screen.findByLabelText('Show in code: UploadWorker.cs:500'));
    await waitFor(() => {
      expect(where(opened)).toEqual({ path: `/session/${SESSION}/step`, step: 's3' });
    });
  });

  it('F-13.2 in a Detailed session Show in code opens S-04 on the same step', async () => {
    const user = userEvent.setup();
    const opened = await openSummary(
      [thread({ id: 'd-1', body: KICK, at: { file: VM, line: 48 } })],
      { mode: 'detailed' },
    );
    await user.click(await screen.findByLabelText(KICK_LABEL));
    await waitFor(() => {
      expect(where(opened)).toEqual({ path: `/session/${SESSION}/detailed`, step: 's4' });
    });
  });

  it('F-13.2 a resolved row has Show in code too', async () => {
    const user = userEvent.setup();
    const opened = await openSummary([
      thread({ id: 'd-1', body: KICK, resolved: true, at: { file: VM, line: 48 } }),
    ]);
    const row = await rowOf(KICK);
    await user.click(await within(row).findByLabelText(KICK_LABEL));
    await waitFor(() => {
      expect(where(opened)).toEqual({ path: `/session/${SESSION}/step`, step: 's4' });
    });
  });

  it('F-13.2 a thread that shows in no step has no Show in code: a file that is no longer in the MR, and a comment on the MR itself', async () => {
    await openSummary([
      thread({ id: 'd-1', body: KICK, at: { file: VM, line: 48 } }),
      thread({ id: 'd-2', body: GONE, at: { file: 'src/Mobile.Core/Gone.cs', line: 10 } }),
      thread({ id: 'd-g', body: GENERAL, by: OLA }),
    ]);
    await within(await rowOf(KICK)).findByLabelText(KICK_LABEL);
    await settle();

    // The deleted file's row still says where the thread was written; it just has no way to open it.
    const gone = await rowOf(GONE);
    expect(gone).toHaveTextContent('Gone.cs:10');
    expect(within(gone).queryByLabelText(/^Show in code/)).toBeNull();
    expect(within(gone).queryByTitle('Show in code')).toBeNull();
    expect(within(await rowOf(GENERAL)).queryByLabelText(/^Show in code/)).toBeNull();
    // Resolve is there all the same.
    expect(rowButton(gone, 'Resolve')).toBeEnabled();
    expect(screen.getAllByLabelText(/^Show in code/)).toHaveLength(1);
  });
});
