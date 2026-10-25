import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { SessionMr } from '../../ipc/types/SessionMr';
import { MrMetaLine } from './MrMetaLine';

// F-20.10 on S-02: the meta line's pipeline status links to S-08 of the merge request; a merge
// request without a pipeline shows no link.

const SESSION: SessionMr = {
  mr: {
    iid: 482,
    title: 'Offline queue for delivery photos',
    author: 'Marta K.',
    sourceBranch: 'feature/offline-upload',
    targetBranch: 'develop',
    pipeline: 'failed',
  },
  groups: [],
  totalFiles: 16,
  additions: 462,
  deletions: 61,
  commits: 3,
};

describe('S-02 meta line pipeline link', () => {
  it('F-20.10 the pipeline status links to S-08 of that merge request', () => {
    render(
      <MemoryRouter>
        <MrMetaLine session={SESSION} />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'pipeline failed' });
    expect(link).toHaveAttribute('href', '/mr/482/pipeline');
  });

  it('F-20.10 without a pipeline there is no link', () => {
    render(
      <MemoryRouter>
        <MrMetaLine session={{ ...SESSION, mr: { ...SESSION.mr, pipeline: undefined } }} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});
