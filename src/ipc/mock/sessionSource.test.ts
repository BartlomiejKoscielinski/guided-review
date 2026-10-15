import { describe, expect, it } from 'vitest';
import { createMockClient } from './index';

describe('mock session_source (F-17.1)', () => {
  it('F-17.1 every opened session knows what it reviews, like the core', async () => {
    const ipc = createMockClient({ latencyMs: 0 });
    await ipc.repoPick();
    const commit = await ipc.sessionOpenCommit({ to: 'a3f9c12' });
    expect(await ipc.sessionSource(commit.sessionId)).toEqual({ kind: 'commits', to: 'a3f9c12' });
    const range = await ipc.sessionOpenCommit({ from: '9be0d47', to: 'a3f9c12' });
    expect(await ipc.sessionSource(range.sessionId)).toEqual({
      kind: 'commits',
      from: '9be0d47',
      to: 'a3f9c12',
    });
    const staged = await ipc.sessionOpenLocal({ kind: 'staged' });
    expect(await ipc.sessionSource(staged.sessionId)).toEqual({
      kind: 'local',
      scope: { kind: 'staged' },
    });
    const branch = await ipc.sessionOpenBranch('chore/compiled-bindings');
    expect(await ipc.sessionSource(branch.sessionId)).toEqual({
      kind: 'local',
      scope: { kind: 'branchVsTarget', target: 'origin/develop' },
    });
    await expect(ipc.sessionSource('nope')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
