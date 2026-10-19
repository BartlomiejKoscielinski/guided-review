import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ThreadPosition } from '../../ipc/types/ThreadPosition';
import {
  ANNA,
  MARTA,
  ME,
  OLA,
  PAWEL,
  QUEUE,
  VM,
  XAML,
  openSummary,
  rowOf,
  thread,
} from '../../test/threadRows';

// F-13.2: a row of S-05's Threads tab (SummaryDesk.dc.html) shows the thread's first message (plain
// text, one line), under it the line "author · N replies · file:line" and, to the right, Resolve
// or Reopen (the actions are in ThreadRowActions.test.tsx, Show in code in ThreadShowInCode.test.tsx).
//
// The mock's meta line, as locked here: `author · N reply|replies` (1 is singular, 0 is "0
// replies"), ` · resolved` after it for a resolved thread, then ` · ` and the location in its own
// element (the mono span). The author is the first note's author, "You" when that is the signed-in
// user (M5 decision 13; compared by username, never by name); a comment on the MR itself has no
// position and so no `file:line` and no dangling " · ". The location is the file NAME and the line
// the thread was written on (new side, else old side), with the full path as the title, as the
// Drafts rows show it (F-12.3).
//
// Decisions locked here (tests stage, M5 / F-13.2): replies count the notes after the first; while
// the signed-in user is not known the list is not held back and the author shows by name.
//
// Locators the rows keep: the thread rows are the list items of the tab panel (role listitem); the
// first message is its own element holding exactly the message text; the location is its own
// element whose text is exactly `file:line` (the mono span) and whose title is the full path.

const KICK = 'Kick() is called on the UI thread. Does the worker block anything here?';
const TABLE = 'Is the table created on every start? CREATE TABLE IF NOT EXISTS would be enough.';
const BANNER = 'Banner color should come from resources, not be hardcoded.';
const NETWORK = 'Do we need ACCESS_NETWORK_STATE here?';
const GENERAL = 'Thanks for the quick turnaround on this one.';
const MANIFEST = 'src/Mobile.App/Platforms/Android/AndroidManifest.xml';

describe('S-05 Threads tab rows (F-13.2)', () => {
  it('F-13.2 a row reads "author · N replies · file:line" after the first message: replies are the notes after the first, one is singular, none is "0 replies"', async () => {
    await openSummary([
      thread({ id: 'd-1', body: KICK, by: PAWEL, replies: [MARTA], at: { file: VM, line: 48 } }),
      thread({
        id: 'd-2',
        body: TABLE,
        by: PAWEL,
        replies: [ANNA, PAWEL],
        at: { file: QUEUE, line: 24 },
      }),
      thread({ id: 'd-3', body: NETWORK, by: OLA, at: { file: MANIFEST, line: 12 } }),
    ]);

    const kick = await rowOf(KICK);
    expect(kick).toHaveTextContent('Paweł S. · 1 reply · DeliveryPhotoViewModel.cs:48');
    expect(kick).not.toHaveTextContent('1 replies');
    expect(await rowOf(TABLE)).toHaveTextContent('Paweł S. · 2 replies · SqliteUploadQueue.cs:24');
    expect(await rowOf(NETWORK)).toHaveTextContent('Ola M. · 0 replies · AndroidManifest.xml:12');

    // The message comes first, the location after it, each in an element of its own.
    const message = within(kick).getByText(KICK);
    const place = within(kick).getByText('DeliveryPhotoViewModel.cs:48');
    expect(message.compareDocumentPosition(place) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The row's own reading in the mock: a reply count is never given as the notes' total.
    expect(kick).not.toHaveTextContent('2 replies');
  });

  it('F-13.2 the location is the file name and the line, and the title is the full path', async () => {
    await openSummary([
      thread({ id: 'd-1', body: KICK, at: { file: VM, line: 48 } }),
      thread({ id: 'd-2', body: TABLE, at: { file: QUEUE, line: 24 } }),
    ]);
    await rowOf(KICK);
    expect(screen.getByText('DeliveryPhotoViewModel.cs:48')).toHaveAttribute('title', VM);
    expect(screen.getByText('SqliteUploadQueue.cs:24')).toHaveAttribute('title', QUEUE);
    // Neither folder shows in the line.
    expect(screen.queryByText(/Mobile\.App\/ViewModels/)).toBeNull();
  });

  it('F-13.2 a renamed file shows its new name and a thread on a removed line shows the old-side line', async () => {
    const sha = { headSha: '9c41e07', baseSha: '5e2a9c4' };
    const renamed: ThreadPosition = {
      oldPath: 'src/Old/Name.cs',
      newPath: 'src/New/Renamed.cs',
      newLine: 7,
      ...sha,
    };
    const removed: ThreadPosition = { oldPath: QUEUE, newPath: QUEUE, oldLine: 12, ...sha };
    await openSummary([
      thread({ id: 'd-1', body: KICK, at: renamed }),
      thread({ id: 'd-2', body: TABLE, at: removed }),
    ]);
    expect(await rowOf(KICK)).toHaveTextContent('Renamed.cs:7');
    expect(screen.getByText('Renamed.cs:7')).toHaveAttribute('title', 'src/New/Renamed.cs');
    expect(await rowOf(TABLE)).toHaveTextContent('SqliteUploadQueue.cs:12');
  });

  it('F-13.2 a resolved row says "· resolved" after its replies, an open row never does', async () => {
    await openSummary([
      thread({ id: 'd-1', body: KICK, replies: [MARTA], at: { file: VM, line: 48 } }),
      thread({
        id: 'd-4',
        body: BANNER,
        by: OLA,
        replies: [ME, OLA],
        resolved: true,
        at: { file: XAML, line: 22 },
      }),
    ]);
    expect(await rowOf(BANNER)).toHaveTextContent(
      'Ola M. · 2 replies · resolved · DeliveryPhotoPage.xaml:22',
    );
    expect(await rowOf(KICK)).not.toHaveTextContent('resolved');
  });

  it('F-13.2 a thread the signed-in user opened says "You"; one they only replied to, or one by a namesake, keeps the author\'s name', async () => {
    const namesake = { username: 'bartek.kowalski', name: 'Bartek K.' };
    await openSummary([
      thread({
        id: 'd-1',
        body: NETWORK,
        by: ME,
        replies: [PAWEL],
        at: { file: MANIFEST, line: 12 },
      }),
      thread({ id: 'd-2', body: KICK, by: PAWEL, replies: [ME], at: { file: VM, line: 48 } }),
      thread({ id: 'd-3', body: TABLE, by: namesake, at: { file: QUEUE, line: 24 } }),
    ]);
    expect(await rowOf(NETWORK)).toHaveTextContent('You · 1 reply · AndroidManifest.xml:12');
    const replied = await rowOf(KICK);
    expect(replied).toHaveTextContent('Paweł S. · 1 reply');
    expect(replied).not.toHaveTextContent('You');
    const other = await rowOf(TABLE);
    expect(other).toHaveTextContent('Bartek K. · 0 replies');
    expect(other).not.toHaveTextContent('You');
  });

  it('F-13.2 while the signed-in user is not known the rows are still listed, with the author by name', async () => {
    await openSummary(
      [thread({ id: 'd-1', body: NETWORK, by: ME, at: { file: MANIFEST, line: 12 } })],
      {
        prepare: (client) => {
          vi.spyOn(client, 'gitlabStatus').mockReturnValue(new Promise(() => undefined));
        },
      },
    );
    const row = await rowOf(NETWORK);
    expect(row).toHaveTextContent('Bartek K. · 0 replies · AndroidManifest.xml:12');
    expect(row).not.toHaveTextContent('You');
  });

  it('F-13.2 a comment on the MR itself has no file:line and no dangling separator', async () => {
    await openSummary([
      thread({ id: 'd-1', body: KICK, at: { file: VM, line: 48 } }),
      thread({ id: 'd-g', body: GENERAL, by: OLA, replies: [PAWEL] }),
    ]);
    const row = await rowOf(GENERAL);
    expect(row).toHaveTextContent(/Ola M\. · 1 reply(?! ·)/);
    expect(row.textContent).not.toMatch(/undefined|null|NaN|\.\w+:\d+/);
    expect(within(row).queryByLabelText(/^Show in code/)).toBeNull();
  });

  it('F-13.2 the first message is plain text: Markdown and tags are shown as written', async () => {
    const written = '**Bold** <b>tag</b> [link](https://example.test/x) `code`';
    await openSummary([thread({ id: 'd-1', body: written, at: { file: VM, line: 48 } })]);
    const row = await rowOf(written);
    const message = within(row).getByText(written);
    expect(message.children).toHaveLength(0);
    expect(row.querySelector('strong, b, em, code, a[href^="http"]')).toBeNull();
  });
});
