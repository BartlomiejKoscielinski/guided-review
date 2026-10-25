import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FixProposal } from '../../ipc/types/FixProposal';
import { FixCard } from './FixCard';

// F-25.3: the fix card, shared by S-05 and S-10 (docs/plans/M7.md; Author.dc.html `fProposed` and
// `fBusy`): the proposal as "Proposed change · Edited 1 file: <name>" with the diff of that file,
// Claude's one sentence, Accept (green) and Discard; while Claude works the line "Claude is
// editing <name>…" with Cancel; a run that edited nothing says "Claude made no change." with
// Claude's sentence and Close (M7 decision 3); a failed run shows its message with Close.
//
// Contract: <FixCard state onAccept onDiscard onCancel onClose /> in src/screens/fix/FixCard.tsx,
//   state = { phase: 'running'; file } | { phase: 'proposed'; proposal: FixProposal }
//         | { phase: 'failed'; file; message },
// `file` being the repository path (the card shows its name), `proposal` the generated
// FixProposal (no hunks = no change). Locators it keeps: the busy line has role "status", the
// failure role "alert", the buttons are plain buttons named exactly Accept, Discard, Cancel and
// Close, and the title and the file line are plain text "Proposed change" and
// "Edited 1 file: <name>".

const FILE = 'src/App/Workers/UploadWorker.cs';
const SENTENCE =
  'Doubles the wait after each attempt (2, 4, 8 … s) and caps it at 60 s, as Marta asked.';
const ADD1 =
  '                var delay = TimeSpan.FromSeconds(Math.Min(Math.Pow(2, attempt), 60));';

const proposal = (overrides: Partial<FixProposal> = {}): FixProposal => ({
  id: 'fix-1',
  file: FILE,
  explanation: SENTENCE,
  hunks: [
    {
      id: 'h1',
      oldStart: 44,
      oldLines: 3,
      newStart: 44,
      newLines: 4,
      header: 'RetryAsync',
      fileLevel: false,
      stagedDiffers: false,
      lines: [
        { kind: 'ctx', oldNo: 44, newNo: 44, text: '            attempt++;', emphasis: [] },
        {
          kind: 'del',
          oldNo: 45,
          text: '                await Task.Delay(1000 * attempt, ct);',
          emphasis: [],
        },
        { kind: 'add', newNo: 45, text: ADD1, emphasis: [] },
        {
          kind: 'add',
          newNo: 46,
          text: '                await Task.Delay(delay, ct);',
          emphasis: [],
        },
        { kind: 'ctx', oldNo: 46, newNo: 47, text: '        }', emphasis: [] },
      ],
    },
  ],
  ...overrides,
});

const handlers = () => ({
  onAccept: vi.fn(),
  onDiscard: vi.fn(),
  onCancel: vi.fn(),
  onClose: vi.fn(),
});

describe('FixCard (F-25.3)', () => {
  beforeEach(() => {
    // jsdom lays nothing out; give elements a size so the virtualized diff renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-25.3 a proposal shows "Proposed change", "Edited 1 file: <name>", the diff and the sentence', () => {
    const { container } = render(
      <FixCard state={{ phase: 'proposed', proposal: proposal() }} {...handlers()} />,
    );
    expect(screen.getByText('Proposed change')).toBeInTheDocument();
    expect(screen.getByText('Edited 1 file: UploadWorker.cs')).toBeInTheDocument();
    expect(screen.getByText(SENTENCE)).toBeInTheDocument();
    const added = [...container.querySelectorAll('[data-kind="add"]')].map((e) => e.textContent);
    const removed = [...container.querySelectorAll('[data-kind="del"]')].map((e) => e.textContent);
    expect(added).toHaveLength(2);
    expect(added[0]).toContain(ADD1.trim());
    expect(added[1]).toContain('await Task.Delay(delay, ct);');
    expect(removed).toHaveLength(1);
    expect(removed[0]).toContain('await Task.Delay(1000 * attempt, ct);');
  });

  it('F-25.3 the file line names the file, not its folder, also with spaces and Polish letters', () => {
    render(
      <FixCard
        state={{
          phase: 'proposed',
          proposal: proposal({ file: 'src/Zażółć gęślą/Upload Queue.cs' }),
        }}
        {...handlers()}
      />,
    );
    expect(screen.getByText('Edited 1 file: Upload Queue.cs')).toBeInTheDocument();
    expect(screen.queryByText(/Zażółć/)).toBeNull();
  });

  it('F-25.3 Accept and Discard are buttons that call their handlers; Accept is the green one', async () => {
    const h = handlers();
    render(<FixCard state={{ phase: 'proposed', proposal: proposal() }} {...h} />);
    const accept = screen.getByRole('button', { name: 'Accept' });
    const discard = screen.getByRole('button', { name: 'Discard' });
    expect(accept).toBeEnabled();
    expect(discard).toBeEnabled();
    // The design system's green fill is the `approve` button variant; Discard is not filled.
    expect(accept.className).toMatch(/approve/);
    expect(discard.className).not.toMatch(/approve|claude|primary/);
    await userEvent.click(accept);
    expect(h.onAccept).toHaveBeenCalledTimes(1);
    expect(h.onDiscard).not.toHaveBeenCalled();
    await userEvent.click(discard);
    expect(h.onDiscard).toHaveBeenCalledTimes(1);
    expect(h.onAccept).toHaveBeenCalledTimes(1);
  });

  it('F-25.3 a proposal has no Cancel and no Close', () => {
    render(<FixCard state={{ phase: 'proposed', proposal: proposal() }} {...handlers()} />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('F-25.3 while Claude works: "Claude is editing <name>…" with Cancel, no Accept', async () => {
    const h = handlers();
    render(<FixCard state={{ phase: 'running', file: FILE }} {...h} />);
    const busy = screen.getByRole('status');
    expect(busy).toHaveTextContent('Claude is editing UploadWorker.cs…');
    expect(screen.queryByText('Proposed change')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(h.onCancel).toHaveBeenCalledTimes(1);
  });

  it('F-25.3 no edit: "Claude made no change." with the sentence and Close, nothing to accept', async () => {
    const h = handlers();
    const none = proposal({ hunks: [], explanation: 'Enqueue already rejects null items.' });
    render(<FixCard state={{ phase: 'proposed', proposal: none }} {...h} />);
    expect(screen.getByText('Claude made no change.')).toBeInTheDocument();
    expect(screen.getByText('Enqueue already rejects null items.')).toBeInTheDocument();
    expect(screen.queryByText('Proposed change')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it('F-25.3 a failed run shows the message as an alert with Close, and no proposal', async () => {
    const h = handlers();
    const message = 'Claude changed files other than UploadWorker.cs, so the run was discarded.';
    render(<FixCard state={{ phase: 'failed', file: FILE, message }} {...h} />);
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(message)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(screen.queryByText('Proposed change')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });
});
