import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithIpc } from '../../test/render';
import { usePlan, useSetStrategy } from './usePlan';
import { useStep } from './useReview';

const SESSION = 'mock-mr-session-1';

function Probe({ stepId }: { stepId: string }) {
  const plan = usePlan(SESSION);
  const step = useStep(plan.query.data ? SESSION : '', stepId);
  const strategy = useSetStrategy(SESSION);
  const view = step.data;
  return (
    <div>
      {view && (
        <span data-testid="header">
          {`Step ${String(view.number)} of ${String(view.total)} · ${view.step.title}`}
        </span>
      )}
      {view && <span data-testid="files">{view.files.length}</span>}
      {step.error && <span>{step.error.message}</span>}
      <button
        type="button"
        onClick={() => {
          strategy.mutate('testsFirst');
        }}
      >
        Tests first
      </button>
    </div>
  );
}

describe('useStep', () => {
  it('F-07.2 the step header data arrives once the plan is there', async () => {
    renderWithIpc(<Probe stepId="s2" />);
    expect(await screen.findByText('Step 2 of 8 · SqliteUploadQueue')).toBeInTheDocument();
    expect(screen.getByTestId('files')).toHaveTextContent('1');
  });

  it('F-07.2 a new step order renumbers the step', async () => {
    renderWithIpc(<Probe stepId="s8" />);
    expect(await screen.findByText('Step 8 of 8 · Queue tests')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Tests first'));
    expect(await screen.findByText('Step 1 of 8 · Queue tests')).toBeInTheDocument();
  });

  it('F-07.2 a step not in the plan shows the error', async () => {
    renderWithIpc(<Probe stepId="s9" />);
    expect(await screen.findByText('The step is not in the plan.')).toBeInTheDocument();
  });
});
