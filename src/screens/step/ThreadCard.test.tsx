import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Thread } from '../../ipc/types/Thread';
import { ThreadCard } from './ThreadCard';

// F-11.1: an existing GitLab thread shows inline as the design's card (Review.dc.html, region
// "Thread at line 48"): an initials square per note, "author · age", the text, and the replies
// under the first note. The text is never rendered as markup (06 › T10).

const PAWEL = { username: 'pawel.s', name: 'Paweł S.' };
const MARTA = { username: 'marta.k', name: 'Marta K.' };
// A day and a few hours after the first note, as in the mock: "yesterday" and "3 h ago".
const NOW = new Date('2026-10-13T09:40:00.000Z');

const THREAD: Thread = {
  id: 'd-1',
  resolvable: true,
  resolved: false,
  outdated: false,
  position: {
    oldPath: 'src/a.cs',
    newPath: 'src/a.cs',
    newLine: 48,
    headSha: '9c41e07',
    baseSha: '5e2a9c4',
  },
  notes: [
    {
      id: 1,
      author: PAWEL,
      body: 'Kick() is called on the UI thread. Does the worker block anything here?',
      createdAt: '2026-10-12T09:31:00.000Z',
    },
    {
      id: 2,
      author: MARTA,
      body: 'Kick only releases a semaphore, the upload runs in the background.',
      createdAt: '2026-10-13T06:40:00.000Z',
    },
    {
      id: 3,
      author: PAWEL,
      body: 'Thanks, that answers it.',
      createdAt: '2026-10-13T09:39:30.000Z',
    },
  ],
};

describe('ThreadCard (F-11.1)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('F-11.1 a note shows its author · age and its text, the replies follow the first note in order', () => {
    render(<ThreadCard thread={THREAD} line={48} />);
    const card = screen.getByRole('region', { name: 'Thread at line 48' });

    const pawel = within(card).getAllByText('Paweł S.', { selector: 'b' });
    expect(pawel).toHaveLength(2);
    expect(pawel[0]?.parentElement).toHaveTextContent(/^Paweł S\. · yesterday$/);
    expect(pawel[1]?.parentElement).toHaveTextContent(/^Paweł S\. · just now$/);
    expect(within(card).getByText('Marta K.', { selector: 'b' }).parentElement).toHaveTextContent(
      /^Marta K\. · 3 h ago$/,
    );
    expect(within(card).getByText('Thanks, that answers it.')).toBeInTheDocument();

    const text = card.textContent;
    const at = (part: string) => text.indexOf(part);
    expect(at('Kick() is called on the UI thread.')).toBeGreaterThanOrEqual(0);
    expect(at('Kick only releases a semaphore')).toBeGreaterThan(
      at('Kick() is called on the UI thread.'),
    );
    expect(at('Thanks, that answers it.')).toBeGreaterThan(at('Kick only releases a semaphore'));
  });

  it('F-11.1 every note has an avatar square with the author’s initials, one colour per author', () => {
    render(<ThreadCard thread={THREAD} line={48} />);
    const card = screen.getByRole('region', { name: 'Thread at line 48' });

    const first = within(card).getAllByText('PS');
    // Paweł S. wrote the first note and the last one: the same square colour (Review.dc.html:
    // PS orange, MK green).
    expect(first).toHaveLength(2);
    expect(first[0]).toHaveAttribute('data-color', 'orange');
    expect(first[1]).toHaveAttribute('data-color', 'orange');
    expect(within(card).getByText('MK')).toHaveAttribute('data-color', 'green');
    // Decoration for assistive technology: the name is in the byline.
    expect(within(card).getByText('MK')).toHaveAttribute('aria-hidden', 'true');
  });

  it('F-11.1 the text is shown as text: HTML in a comment never becomes an element (06 T10)', () => {
    const hostile: Thread = {
      ...THREAD,
      notes: [
        {
          id: 9,
          author: PAWEL,
          body: 'Look: <img src="x" onerror="alert(1)"> and <script>alert(1)</script> then <b>bold</b> end',
          createdAt: '2026-10-12T09:31:00.000Z',
        },
      ],
    };
    const { container } = render(<ThreadCard thread={hostile} line={48} />);
    const card = screen.getByRole('region', { name: 'Thread at line 48' });

    expect(container.querySelector('img, script, [onerror]')).toBeNull();
    // Only the byline has a <b>; the comment's own <b> is not an element.
    expect(card.querySelectorAll('b')).toHaveLength(1);
    expect(card).toHaveTextContent('Look:');
    expect(card).toHaveTextContent('end');
  });
});
