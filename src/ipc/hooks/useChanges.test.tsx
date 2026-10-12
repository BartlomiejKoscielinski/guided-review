import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithIpc, mockClient } from '../../test/render';
import { useLocalChanges, useRepoChangedRefresh } from './useChanges';

function Probe() {
  useRepoChangedRefresh();
  const status = useLocalChanges(true);
  return <span>{status.data ? `${String(status.data.stagedFiles)} staged` : 'loading'}</span>;
}

describe('useRepoChangedRefresh', () => {
  it('F-16.2 refetches local changes when the working tree or index changed outside', async () => {
    let fire: () => void = () => undefined;
    const base = mockClient();
    const gitStatus = vi.fn(() => base.gitStatus());
    renderWithIpc(<Probe />, {
      gitStatus,
      onRepoChanged: (listener) => {
        fire = listener;
        return Promise.resolve(() => undefined);
      },
    });
    expect(await screen.findByText('80 staged')).toBeInTheDocument();
    expect(gitStatus).toHaveBeenCalledTimes(1);
    fire();
    await waitFor(() => {
      expect(gitStatus).toHaveBeenCalledTimes(2);
    });
  });
});
