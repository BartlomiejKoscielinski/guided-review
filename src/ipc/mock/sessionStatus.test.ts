import { describe, expect, it } from 'vitest';
import { createMockClient } from './index';

// F-12.7: S-05 asks whether a session is "drafts only" (no steps), as the core's `session_status`.
const ignore = () => undefined;

describe('mock session status (F-12.7)', () => {
  it('F-12.7 a session made by a draft from outside a review is draftsOnly', async () => {
    const ipc = createMockClient({ latencyMs: 0 });
    const draft = await ipc.draftsCreateForMr('mobile/mobile-app', 482, {
      body: 'Is the keystore secret set for this branch?',
      position: null,
      severity: 'q',
    });

    await expect(ipc.sessionStatus(draft.sessionId)).resolves.toBe('draftsOnly');
  });

  it('F-12.7 a review is planning until its plan is shown, then reviewing', async () => {
    const ipc = createMockClient({ latencyMs: 0 });
    const { sessionId } = await ipc.sessionOpenMr(482, null, 'task', ignore);

    await expect(ipc.sessionStatus(sessionId)).resolves.toBe('planning');
    await ipc.reviewPlan(sessionId, ignore);
    await expect(ipc.sessionStatus(sessionId)).resolves.toBe('reviewing');
  });

  it('F-12.7 an unknown session is refused like the core: Unknown session.', async () => {
    const ipc = createMockClient({ latencyMs: 0 });

    await expect(ipc.sessionStatus('nope')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Unknown session.',
    });
  });
});
