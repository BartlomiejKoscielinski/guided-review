import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithIpc } from '../../test/render';
import { IpcError } from '../errors';
import { usePlan, useReorderSteps, useSetStrategy } from './usePlan';

const SESSION = 'mock-mr-session-1';
const DRAGGED = ['s8', 's1', 's2', 's3', 's4', 's5', 's6', 's7'];

function Probe() {
  const { query, phase } = usePlan(SESSION);
  const strategy = useSetStrategy(SESSION);
  const reorder = useReorderSteps(SESSION);
  const order = query.data?.order;
  return (
    <div>
      <span data-testid="phase">{phase}</span>
      <span data-testid="order">
        {order ? `${order.custom ? 'custom' : order.strategy}:${order.order.join(',')}` : 'none'}
      </span>
      {query.error && <span>{query.error.message}</span>}
      <button
        type="button"
        onClick={() => {
          strategy.mutate('testsFirst');
        }}
      >
        Tests first
      </button>
      <button
        type="button"
        onClick={() => {
          reorder.mutate(DRAGGED);
        }}
      >
        Drop
      </button>
    </div>
  );
}

describe('usePlan', () => {
  it('F-06.12 phase follows the task events and the plan arrives', async () => {
    renderWithIpc(<Probe />);
    expect(await screen.findByText('contractToUi:s1,s2,s3,s4,s5,s6,s7,s8')).toBeInTheDocument();
    expect(screen.getByTestId('phase')).toHaveTextContent('done');
  });

  it('F-06.2 a failed plan shows the error', async () => {
    const error = {
      code: 'CLAUDE_FAILED',
      message: 'Claude Code failed.',
      retryable: true,
    } as const;
    renderWithIpc(<Probe />, {
      reviewPlan: (_session, onEvent) => {
        onEvent({ kind: 'queued' });
        onEvent({ kind: 'failed', error });
        return Promise.reject(new IpcError(error));
      },
    });
    expect(await screen.findByText('Claude Code failed.')).toBeInTheDocument();
    expect(screen.getByTestId('phase')).toHaveTextContent('failed');
  });

  it('F-06.4 switching the strategy reorders the cached plan', async () => {
    renderWithIpc(<Probe />);
    await screen.findByText(/^contractToUi:/);
    fireEvent.click(screen.getByRole('button', { name: 'Tests first' }));
    expect(await screen.findByText('testsFirst:s8,s1,s2,s3,s4,s5,s6,s7')).toBeInTheDocument();
  });

  it('F-06.5 a drop moves the rows at once and goes back when refused', async () => {
    let refuse: (e: Error) => void = () => undefined;
    const reviewReorderSteps = vi.fn(
      () =>
        new Promise<never>((_, reject) => {
          refuse = reject;
        }),
    );
    renderWithIpc(<Probe />, { reviewReorderSteps });
    await screen.findByText(/^contractToUi:/);
    fireEvent.click(screen.getByRole('button', { name: 'Drop' }));
    expect(await screen.findByText(`custom:${DRAGGED.join(',')}`)).toBeInTheDocument();
    expect(reviewReorderSteps).toHaveBeenCalledWith(SESSION, DRAGGED);
    refuse(new IpcError({ code: 'INVALID_INPUT', message: 'No.', retryable: false }));
    await waitFor(() => {
      expect(screen.getByTestId('order')).toHaveTextContent('contractToUi:s1,');
    });
  });

  it('F-06.5 an accepted drop is kept', async () => {
    renderWithIpc(<Probe />);
    await screen.findByText(/^contractToUi:/);
    fireEvent.click(screen.getByRole('button', { name: 'Drop' }));
    expect(await screen.findByText(`custom:${DRAGGED.join(',')}`)).toBeInTheDocument();
  });
});
