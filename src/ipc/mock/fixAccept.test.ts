import { describe, expect, it } from 'vitest';
import { createMockClient } from './index';
import type { FixProposal } from '../types/FixProposal';

// F-25.4: the mock's `fixAccept(id)` and `fixDiscard(id)` answer like the core's commands
// (docs/plans/M7.md): a proposal that `fixPropose` returned is open until Accept or Discard takes
// it; Accept of an id that is not open is INVALID_INPUT "This fix is no longer open."; Discard of
// such an id is fine (nothing to drop). Same guard order and code as `fix/accept.rs`.

const PENDING = 'PendingCount won’t refresh after upload';

async function openProposal(): Promise<{
  ipc: ReturnType<typeof createMockClient>;
  proposal: FixProposal;
}> {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const { sessionId } = await ipc.sessionOpenLocal({ kind: 'staged' });
  await ipc.reviewPlan(sessionId, () => undefined);
  const analysis = await ipc.reviewFindings(sessionId, 's4', () => undefined);
  const finding = analysis.findings.find((f) => f.title === PENDING);
  if (!finding) throw new Error('the PendingCount note is missing');
  const proposal = await ipc.fixPropose(
    { task: 'fix-1', sessionId, findingId: finding.id },
    () => undefined,
  );
  return { ipc, proposal };
}

describe('mock fixAccept and fixDiscard (F-25.4)', () => {
  it('F-25.4 Accept of an open proposal resolves, and the proposal is closed afterwards', async () => {
    const { ipc, proposal } = await openProposal();
    await expect(ipc.fixAccept(proposal.id)).resolves.toBeUndefined();
    await expect(ipc.fixAccept(proposal.id)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'This fix is no longer open.',
    });
  });

  it('F-25.4 Accept of an id that was never open is INVALID_INPUT', async () => {
    const { ipc } = await openProposal();
    await expect(ipc.fixAccept('fix-nope')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'This fix is no longer open.',
    });
  });

  it('F-25.4 Discard closes the proposal: Accept then finds nothing open', async () => {
    const { ipc, proposal } = await openProposal();
    await expect(ipc.fixDiscard(proposal.id)).resolves.toBeUndefined();
    await expect(ipc.fixAccept(proposal.id)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('F-25.4 Discard of a proposal that is not open resolves', async () => {
    const { ipc, proposal } = await openProposal();
    await ipc.fixDiscard(proposal.id);
    await expect(ipc.fixDiscard(proposal.id)).resolves.toBeUndefined();
    await expect(ipc.fixDiscard('fix-nope')).resolves.toBeUndefined();
  });

  it('F-25.4 two proposals in a row have different ids, each accepted on its own', async () => {
    const { ipc, proposal: first } = await openProposal();
    await ipc.fixAccept(first.id);
    const { sessionId } = await ipc.sessionOpenLocal({ kind: 'staged' });
    await ipc.reviewPlan(sessionId, () => undefined);
    const analysis = await ipc.reviewFindings(sessionId, 's4', () => undefined);
    const finding = analysis.findings.find((f) => f.title === PENDING);
    if (!finding) throw new Error('the PendingCount note is missing');
    const second = await ipc.fixPropose(
      { task: 'fix-2', sessionId, findingId: finding.id },
      () => undefined,
    );
    expect(second.id).not.toBe(first.id);
    await expect(ipc.fixAccept(second.id)).resolves.toBeUndefined();
  });
});
