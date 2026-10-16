import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../test/renderApp';

// Settings › Shortcuts (S-07, Settings.dc.html `{"section":"shortcuts"}`), F-19.3: every shortcut
// of F-30.6 in the groups Review, Code, App (M4 decision 3), with the mock's labels and keys.

interface Row {
  label: string;
  keys: string[];
}

const REVIEW: readonly Row[] = [
  { label: 'Next change', keys: ['↓'] },
  { label: 'Previous change', keys: ['↑'] },
  { label: 'Next file', keys: ['→'] },
  { label: 'Previous file', keys: ['←'] },
  { label: 'Mark file reviewed', keys: ['Space'] },
  { label: 'Next note', keys: ['N'] },
  { label: 'Add to drafts', keys: ['D'] },
  { label: 'Dismiss note', keys: ['X'] },
  { label: 'Comment on line', keys: ['C'] },
  { label: 'Ask Claude', keys: ['A'] },
  { label: 'Primary action (plan, re-review)', keys: ['Enter'] },
];

const CODE: readonly Row[] = [
  { label: 'Go to definition', keys: ['F12'] },
  { label: 'Find usages', keys: ['Shift', 'F12'] },
  { label: 'Open in Rider', keys: ['Ctrl', 'Shift', 'O'] },
];

const APP: readonly Row[] = [
  { label: 'Open anything', keys: ['Ctrl', 'K'] },
  { label: 'Settings', keys: ['Ctrl', ','] },
  { label: 'Switch Focus / Detailed', keys: ['Ctrl', 'D'] },
  { label: 'Sidebar layout', keys: ['Ctrl', '1'] },
  { label: 'Minimal layout', keys: ['Ctrl', '2'] },
  { label: 'Guide layout', keys: ['Ctrl', '3'] },
  { label: 'Close popover', keys: ['Esc'] },
  { label: 'All shortcuts', keys: ['?'] },
];

/** The shortcuts of F-30.6 as key chords (`Ctrl+1/2/3` are three shortcuts). */
const F30_6_CHORDS = [
  '↓',
  '↑',
  '→',
  '←',
  'Space',
  'N',
  'D',
  'X',
  'C',
  'A',
  'F12',
  'Shift F12',
  'Ctrl Shift O',
  'Ctrl K',
  'Ctrl ,',
  'Ctrl D',
  'Ctrl 1',
  'Ctrl 2',
  'Ctrl 3',
  'Enter',
  'Esc',
  '?',
];

/** An element's text without its keys: a row's label. */
function labelText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll('kbd').forEach((kbd) => {
    kbd.remove();
  });
  return clone.textContent.trim();
}

/**
 * The shortcut rows of a group in screen order: each row holds its label and its keys, one
 * `<kbd>` per key (the mock's row: label left, keys right).
 */
function rowsOf(group: HTMLElement): Row[] {
  const rows: Row[] = [];
  const seen = new Set<Element>();
  for (const kbd of group.querySelectorAll('kbd')) {
    let row = kbd.parentElement;
    while (row && row !== group && labelText(row) === '') row = row.parentElement;
    if (!row || seen.has(row)) continue;
    seen.add(row);
    rows.push({
      label: labelText(row),
      keys: [...row.querySelectorAll('kbd')].map((key) => key.textContent.trim()),
    });
  }
  return rows;
}

const group = (name: string) => screen.getByRole('region', { name });

async function openShortcuts() {
  renderApp({ screen: 'S-07', section: 'shortcuts' });
  expect(await screen.findByRole('heading', { name: 'Shortcuts', level: 1 })).toBeInTheDocument();
}

describe('Settings › Shortcuts', () => {
  it('F-19.3 groups the shortcuts under Review, Code and App, in that order', async () => {
    await openShortcuts();
    expect(screen.getByRole('heading', { name: 'Review', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Code', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'App', level: 2 })).toBeInTheDocument();
    const review = group('Review');
    const code = group('Code');
    const app = group('App');
    expect(review.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(code.compareDocumentPosition(app) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('F-19.3 Review lists the change, file, note, draft, comment, ask and primary-action keys', async () => {
    await openShortcuts();
    expect(rowsOf(group('Review'))).toEqual(REVIEW);
  });

  it('F-19.3 Code lists Go to definition, Find usages and Open in Rider', async () => {
    await openShortcuts();
    expect(rowsOf(group('Code'))).toEqual(CODE);
  });

  it('F-19.3 App lists Open anything, Settings, the mode and layout keys, Esc and ?', async () => {
    await openShortcuts();
    expect(rowsOf(group('App'))).toEqual(APP);
  });

  it('F-19.3 every F-30.6 shortcut is listed exactly once across the groups', async () => {
    await openShortcuts();
    const rows = ['Review', 'Code', 'App'].flatMap((name) => rowsOf(group(name)));
    const chords = rows.map((row) => row.keys.join(' '));
    expect([...chords].sort()).toEqual([...F30_6_CHORDS].sort());
    expect(new Set(rows.map((row) => row.label)).size).toBe(rows.length);
  });
});
