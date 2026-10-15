import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import { NOTES_STEP } from './fixtures/review';

const SESSION = 'mock-mr-session-1';
const STEPS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

describe('mock notes next to existing threads', () => {
  it('F-09.5 no mock note repeats an existing thread: a note never sits on the file and line of a thread of its step (Review.dc.html, Main.dc.html)', async () => {
    const mock = createMockClient({ latencyMs: 0 });
    await mock.reviewPlan(SESSION, () => undefined);
    let withBoth = 0;
    for (const id of STEPS) {
      const { threads } = await mock.reviewStep(SESSION, id);
      const { findings } = await mock.reviewFindings(SESSION, id, () => undefined);
      if (threads.length > 0 && findings.length > 0) withBoth += 1;
      for (const thread of threads) {
        const place = [thread.position?.newPath, thread.position?.newLine];
        for (const note of findings) {
          expect([note.file, note.line], `${note.id} in ${id}`).not.toEqual(place);
        }
      }
    }
    // The premise: the design's step 4 shows the thread on _worker.Kick() and Claude's four
    // notes, on other lines of the same file.
    expect(withBoth).toBe(1);
    const step = await mock.reviewStep(SESSION, NOTES_STEP);
    expect(step.threads.map((t) => t.position?.newLine)).toEqual([48]);
    const { findings } = await mock.reviewFindings(SESSION, NOTES_STEP, () => undefined);
    expect(findings.map((f) => f.line)).toEqual([46, 49, 51, 54]);
    expect(findings.every((f) => f.file === step.threads[0]?.position?.newPath)).toBe(true);
  });
});
