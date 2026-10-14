import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  MOCK_ORDERS,
  MOCK_SKIM_FILES,
  MOCK_SKIM_STATS,
  MOCK_STEP_STATS,
  mockPlan,
} from '../../ipc/mock/fixtures/plan';
import { mockFallbackView } from '../../ipc/mock/fixtures/planFallback';
import type { PlanView } from '../../ipc/types/PlanView';
import { PlanList } from './PlanList';

const view = (order: Partial<PlanView['order']> = {}): PlanView => ({
  plan: mockPlan(),
  order: { strategy: 'contractToUi', custom: false, order: MOCK_ORDERS.contractToUi, ...order },
  stepStats: MOCK_STEP_STATS,
  skimStats: MOCK_SKIM_STATS,
  skimFiles: [[...MOCK_SKIM_FILES]],
  reviewed: [],
});

function renderList(v: PlanView = view()) {
  const onStrategy = vi.fn();
  const onReorder = vi.fn();
  render(<PlanList view={v} onStrategy={onStrategy} onReorder={onReorder} />);
  return { onStrategy, onReorder };
}

const rows = () =>
  within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .filter((li) => li.dataset.step);

describe('S-02 PlanList', () => {
  it('F-06.3 rows: number, title, layer tag, reason, N files and +add −del', () => {
    renderList();
    expect(screen.getByRole('heading', { name: 'Plan · 8 steps' })).toBeInTheDocument();
    const all = rows();
    expect(all).toHaveLength(8);
    const first = all[0] as HTMLElement;
    expect(first).toHaveTextContent('1');
    expect(first).toHaveTextContent('Queue contract');
    expect(within(first).getByText('Core')).toBeInTheDocument();
    expect(first).toHaveTextContent(
      'IUploadQueue and PendingUpload. Everything else builds on this.',
    );
    expect(first).toHaveTextContent('2 files · +38');
    expect(first).not.toHaveTextContent('−');
    expect(all[3]).toHaveTextContent('1 file · +18 −9');
    expect(within(all[4] as HTMLElement).getByText('XAML')).toBeInTheDocument();
  });

  it('F-06.4 the toggle shows the strategy and its caption, and picks another', async () => {
    const { onStrategy } = renderList();
    expect(screen.getByRole('radio', { name: 'Contract to UI' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      screen.getByText('Contract to UI: start with what everything else builds on.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Tests first' }));
    expect(onStrategy).toHaveBeenCalledWith('testsFirst');
  });

  it('F-06.4 rows follow the order; File order has the GitLab caption', () => {
    renderList(view({ strategy: 'fileOrder', order: MOCK_ORDERS.fileOrder }));
    expect(rows().map((r) => r.dataset.step)).toEqual(MOCK_ORDERS.fileOrder);
    expect(rows()[0]).toHaveTextContent('DI registration and worker start');
    expect(
      screen.getByText(
        'File order, as in GitLab: the UI shows up before the contract it relies on.',
      ),
    ).toBeInTheDocument();
  });

  it('F-06.5 a dragged order: no strategy selected, the caption says how to reset', () => {
    renderList(view({ custom: true, order: ['s2', 's1', 's3', 's4', 's5', 's6', 's7', 's8'] }));
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false');
    }
    expect(screen.getByText('Your order. Pick a strategy to reset it.')).toBeInTheDocument();
    expect(rows()[0]).toHaveTextContent('SqliteUploadQueue');
  });

  it('F-06.5 each row has a keyboard drag handle', () => {
    renderList();
    const handle = screen.getByRole('button', { name: 'Move step: Queue contract' });
    expect(handle).toHaveAttribute('aria-roledescription', 'sortable');
    expect(screen.getAllByRole('button', { name: /^Move step:/ })).toHaveLength(8);
  });

  it('F-06.6 skim row: "Skim: N mechanical files", the reason, Show lists the files', async () => {
    renderList();
    expect(screen.getByText('Skim: 5 mechanical files')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Formatting (3), csproj with a new package, 3 keys in Strings.resx. Checked: no logic changes.',
      ),
    ).toBeInTheDocument();
    const show = screen.getByRole('button', { name: 'Show' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(show);
    const files = screen.getByRole('list', { name: 'Skim files' });
    expect(within(files).getAllByRole('listitem')).toHaveLength(5);
    expect(files).toHaveTextContent('src/Mobile.App/Mobile.App.csproj');
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByRole('list', { name: 'Skim files' })).not.toBeInTheDocument();
  });

  it('F-06.4 the fallback plan: File order only, rows without handles, no skim', () => {
    renderList(
      mockFallbackView({ code: 'CLAUDE_FAILED', message: 'Claude Code failed.', retryable: true }),
    );
    expect(screen.getByRole('radio', { name: 'File order' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Contract to UI' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Tests first' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Move step:/ })).not.toBeInTheDocument();
    expect(rows()[0]).toHaveTextContent('App');
    expect(screen.queryByText(/^Skim:/)).not.toBeInTheDocument();
  });
});
