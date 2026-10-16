import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileDiff } from '../ipc/types/FileDiff';
import { DiffView } from './DiffView';
import { languageOf } from './language';

const diff: FileDiff = {
  status: 'modified',
  binary: false,
  additions: 2,
  deletions: 1,
  layer: 'app',
  lineStaging: true,
  hunks: [
    {
      id: 'h1',
      oldStart: 20,
      oldLines: 3,
      newStart: 22,
      newLines: 4,
      header: '',
      fileLevel: false,
      stagedDiffers: false,
      lines: [
        { kind: 'ctx', oldNo: 20, newNo: 22, text: '<Grid>', emphasis: [] },
        {
          kind: 'del',
          oldNo: 21,
          text: '<Label a="1" />',
          emphasis: [{ start: 10, end: 11 }],
          staged: true,
        },
        {
          kind: 'add',
          newNo: 23,
          text: '<Label a="2"',
          emphasis: [{ start: 10, end: 11 }],
          staged: true,
        },
        { kind: 'add', newNo: 24, text: '  b="3" />', emphasis: [], staged: false },
        { kind: 'ctx', oldNo: 22, newNo: 25, text: '</Grid>', emphasis: [] },
      ],
    },
  ],
};

describe('DiffView', () => {
  beforeEach(() => {
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-16.1 hunk checkbox is tri-state and writes the whole hunk', () => {
    const onHunk = vi.fn();
    const onLine = vi.fn();
    render(<DiffView path="a.xaml" diff={diff} layout="unified" staging={{ onHunk, onLine }} />);
    const box = screen.getByRole('checkbox', { name: 'In commit · lines 22–25' });
    expect(box).toHaveAttribute('aria-checked', 'mixed');
    fireEvent.click(box);
    expect(onHunk).toHaveBeenCalledWith(diff.hunks[0], true);
  });

  it('F-16.1 Shift+click on a line number toggles that line only', () => {
    const onLine = vi.fn();
    const { container } = render(
      <DiffView path="a.xaml" diff={diff} layout="unified" staging={{ onHunk: vi.fn(), onLine }} />,
    );
    const cell = container.querySelector('[data-kind="add"] [data-line-no="24"]');
    if (!cell) throw new Error('line 24 not rendered');
    fireEvent.click(cell);
    expect(onLine).not.toHaveBeenCalled();
    fireEvent.click(cell, { shiftKey: true });
    expect(onLine).toHaveBeenCalledWith(diff.hunks[0]?.lines[3], true);
    // Unstaged changes are dimmed; staged ones are not.
    expect(container.querySelector('[data-staged="false"]')?.className).toMatch(/dim/);
    expect(container.querySelector('[data-staged="true"]')?.className).not.toMatch(/dim/);
  });

  it('F-15.5 marks intraline changes and renders split rows', () => {
    const { container } = render(<DiffView path="a.xaml" diff={diff} layout="split" />);
    expect(container.querySelectorAll('[class*="emAdd"]')).toHaveLength(1);
    expect(container.querySelectorAll('[class*="emDel"]')).toHaveLength(1);
    expect(container.querySelectorAll('[class*="empty"]')).toHaveLength(1);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('F-07.4 a mechanical hunk is a fold row with its reason until Show', () => {
    const mechanical: FileDiff = {
      ...diff,
      hunks: diff.hunks.map((h) => ({ ...h, mechanical: 'whitespace' as const })),
    };
    const { container } = render(<DiffView path="a.xaml" diff={mechanical} layout="split" />);
    expect(screen.getByText('Whitespace only')).toBeInTheDocument();
    expect(container.querySelector('[data-kind]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.queryByText('Whitespace only')).toBeNull();
    expect(container.querySelector('[data-kind="add"]')).not.toBeNull();
  });

  it('F-30.6 a reveal scrolls once: an older request shown again does not scroll back', async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: scrollTo,
    });
    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
    const inserts = new Map([
      ['n23', <p key="note">note under 23</p>],
      ['n25', <p key="comment">composer under 25</p>],
    ]);
    const view = (reveal: { at: string; nonce: number }) => (
      <DiffView
        path="a.xaml"
        diff={diff}
        layout="split"
        headers={false}
        inserts={inserts}
        reveal={reveal}
      />
    );
    try {
      // N picked the note (an older request), then C opened the composer (a newer one).
      const { rerender } = render(view({ at: 'n23', nonce: 3 }));
      rerender(view({ at: 'n25', nonce: 5 }));
      await settle();
      expect(scrollTo).toHaveBeenCalled();
      scrollTo.mockClear();
      // Esc closed the composer: the note's request is the latest shown again, already handled.
      rerender(view({ at: 'n23', nonce: 3 }));
      await settle();
      expect(scrollTo).not.toHaveBeenCalled();
      // A new request for the note (N again) scrolls.
      rerender(view({ at: 'n23', nonce: 8 }));
      await settle();
      expect(scrollTo).toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
    }
  });

  it('F-07.5 gutter markers sit on their line, inserts follow it', () => {
    render(
      <DiffView
        path="a.xaml"
        diff={diff}
        layout="split"
        headers={false}
        markers={new Map([['n24', <span key="m">marker</span>]])}
        inserts={new Map([['n24', <p key="c">card under 24</p>]])}
      />,
    );
    expect(screen.getByText('marker').closest('[data-line-no]')).toHaveAttribute(
      'data-line-no',
      '24',
    );
    expect(screen.queryByText(/lines 22/)).toBeNull();
    const rows = Array.from(document.querySelectorAll('[data-index]'));
    const at = rows.findIndex((r) => r.textContent.includes('card under 24'));
    expect(rows[at - 1]?.querySelector('[data-line-no="24"]')).not.toBeNull();
  });

  it('F-07.5 in the unified layout a removed line’s marker sits on its old-side number', () => {
    render(
      <DiffView
        path="a.xaml"
        diff={diff}
        layout="unified"
        headers={false}
        markers={new Map([['o21', <span key="m">old marker</span>]])}
      />,
    );
    const cell = screen.getByText('old marker').closest('[data-line-no]');
    expect(cell).toHaveAttribute('data-line-no', '21');
    expect(cell?.closest('[data-kind]')).toHaveAttribute('data-kind', 'del');
  });

  it('F-05.2 a binary file shows a note instead of lines', () => {
    const binary: FileDiff = {
      ...diff,
      binary: true,
      lineStaging: false,
      hunks: diff.hunks.map((h) => ({ ...h, fileLevel: true, lines: [] })),
    };
    render(
      <DiffView path="logo.png" diff={binary} layout="unified" empty="Binary file. Not shown." />,
    );
    expect(screen.getByText('Binary file. Not shown.')).toBeInTheDocument();
  });

  it('picks grammars by extension', () => {
    expect(languageOf('src/App/Views/A.xaml')).toBe('xml');
    expect(languageOf('src/App/App.csproj')).toBe('xml');
    expect(languageOf('src/A.cs')).toBe('csharp');
    expect(languageOf('README')).toBeNull();
    expect(languageOf('image.png')).toBeNull();
  });
});
