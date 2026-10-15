import { render, screen, within } from '@testing-library/react';
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

  // What Show does (opens the MR browse with the skim files) is tested in SkimRow.test.tsx.
  it('F-06.6 skim row: "Skim: N mechanical files", the reason and Show, after the steps', () => {
    renderList();
    const skim = screen.getByText('Skim: 5 mechanical files').closest('li') as HTMLElement;
    expect(skim).toHaveTextContent(
      'Formatting (3), csproj with a new package, 3 keys in Strings.resx. Checked: no logic changes.',
    );
    expect(within(skim).getByRole('button', { name: 'Show' })).toBeInTheDocument();
    expect(skim.dataset.step).toBeUndefined();
    expect(within(skim).queryByRole('button', { name: /^Move step:/ })).not.toBeInTheDocument();
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.at(-1)).toBe(skim);
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
