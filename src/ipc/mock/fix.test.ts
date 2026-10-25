import { describe, expect, it } from 'vitest';
import { createMockClient } from './index';
import type { FixProposal } from '../types/FixProposal';
import type { ClaudeTaskEvent } from '../types/ClaudeTaskEvent';

// F-25.3: the mock's `fixPropose` answers like the core's `fix_propose` (docs/plans/M7.md): the
// task events (`started`, then `done` with the FixProposal), a proposal that edits the one file
// the note points at, and the same refusal as the core's eligibility check (F-25.1): a
// teammate's MR is never fixed (FIX_NOT_ALLOWED). `claudeCancel(task)` ends a run with CANCELLED.
// Contract: `fixPropose(target, onEvent)` with `target = { task, sessionId, findingId }` (a note
// card) or `{ task, sessionId, draftId }` (a kept note on S-05); `FixProposal { id, file, hunks,
// explanation }` with the generated types. The mock waits about 1.3 s (the design mock's
// Author.dc.html timer) so the busy line is visible in dev:mock and in e2e; it is not scaled
// by `latencyMs`.

const MR_SESSION = 'mock-mr-session-1';
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
const PENDING = 'PendingCount won’t refresh after upload';

/** A self-review of the staged changes with step 4's notes loaded. */
async function selfReview() {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  const { sessionId } = await ipc.sessionOpenLocal({ kind: 'staged' });
  await ipc.reviewPlan(sessionId, () => undefined);
  const analysis = await ipc.reviewFindings(sessionId, 's4', () => undefined);
  const finding = analysis.findings.find((f) => f.title === PENDING);
  if (!finding) throw new Error('the PendingCount note is missing');
  return { ipc, sessionId, finding };
}

describe('mock fixPropose (F-25.3)', () => {
  it('F-25.3 a note of a self-review gets started, then a proposal for the note’s one file', async () => {
    const { ipc, sessionId, finding } = await selfReview();
    const events: ClaudeTaskEvent<FixProposal>['kind'][] = [];
    const proposal = await ipc.fixPropose(
      { task: 'fix-1', sessionId, findingId: finding.id },
      (e) => events.push(e.kind),
    );
    expect(events).toEqual(['started', 'done']);
    expect(proposal.file).toBe(VM);
    expect(proposal.id).not.toBe('');
    // A diff of that file: lines added and lines taken out, as the design mock's card shows.
    const lines = proposal.hunks.flatMap((h) => h.lines);
    expect(lines.some((l) => l.kind === 'add')).toBe(true);
    expect(lines.some((l) => l.kind === 'del')).toBe(true);
    // One sentence of explanation.
    expect(proposal.explanation).toMatch(/^[^.!?]+[.!?]$/);
  });

  it('F-25.3 a kept note (a draft on a file) gets a proposal for its file', async () => {
    const { ipc, sessionId } = await selfReview();
    const draft = await ipc.draftsCreate({
      sessionId,
      findingId: null,
      body: 'Refresh PendingCount after each upload',
      position: { file: VM, side: 'new', line: 49 },
      severity: 'fix',
    });
    const proposal = await ipc.fixPropose(
      { task: 'fix-2', sessionId, draftId: draft.id },
      () => undefined,
    );
    expect(proposal.file).toBe(VM);
    expect(proposal.hunks.length).toBeGreaterThan(0);
  });

  it('F-25.3 Cancel ends the run: claudeCancel(task) makes fixPropose fail with CANCELLED', async () => {
    const { ipc, sessionId, finding } = await selfReview();
    const run = ipc.fixPropose(
      { task: 'fix-3', sessionId, findingId: finding.id },
      () => undefined,
    );
    // The run is under way (the mock answers after about 1.3 s).
    await new Promise((resolve) => setTimeout(resolve, 30));
    await ipc.claudeCancel('fix-3');
    await expect(run).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('F-25.3 a teammate’s MR is refused with FIX_NOT_ALLOWED and no run starts', async () => {
    const ipc = createMockClient({ latencyMs: 0 });
    await ipc.repoPick();
    const events: string[] = [];
    await expect(
      ipc.fixPropose({ task: 'fix-4', sessionId: MR_SESSION, findingId: 'f2' }, (e) =>
        events.push(e.kind),
      ),
    ).rejects.toMatchObject({ code: 'FIX_NOT_ALLOWED' });
    expect(events).toEqual([]);
  });
});
