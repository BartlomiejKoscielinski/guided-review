import { describe, expect, it } from 'vitest';
import { MAX_LOG_LINES, applyLogEvent } from '../../ipc/hooks/useJobLog';
import type { JobRow } from '../../ipc/types/JobRow';
import type { LogLine } from '../../ipc/types/LogLine';
import { jobDetailsMeta } from './pipelineText';

const row = (over: Partial<JobRow>): JobRow => ({
  id: 1,
  name: 'unit-tests',
  state: 'passed',
  action: null,
  durationSecs: null,
  webUrl: null,
  ...over,
});
const plain = (n: number): LogLine => ({ kind: 'plain', text: `line ${String(n)}` });

describe('job details text (F-20.5)', () => {
  it('F-20.5 the meta line starts like a sentence, as in Pipeline.dc.html', () => {
    expect(jobDetailsMeta(row({ state: 'failed', durationSecs: 112 }), 'test')).toBe(
      'Test stage · 1:52',
    );
    expect(jobDetailsMeta(row({ state: 'running' }), 'build')).toBe(
      'Build stage · started just now',
    );
    expect(jobDetailsMeta(row({ state: 'canceled', durationSecs: null }), 'quality')).toBe(
      'Quality stage',
    );
  });

  it('F-20.5 a job running for a while shows how long it has run, not "started just now"', () => {
    expect(jobDetailsMeta(row({ state: 'running', durationSecs: 20 * 60 + 5 }), 'test')).toBe(
      'Test stage · running 20:05',
    );
    expect(jobDetailsMeta(row({ state: 'canceled', durationSecs: null }), 'quality')).toBe(
      'Quality stage',
    );
  });

  it('F-20.5 appended lines past 500 keep the last 500 and mark the log cut', () => {
    const start = applyLogEvent(
      { lines: [], truncated: false, error: null, replaces: 0 },
      {
        lines: Array.from({ length: MAX_LOG_LINES }, (_, i) => plain(i + 1)),
        replace: true,
        truncated: false,
        done: false,
      },
    );
    const next = applyLogEvent(start, {
      lines: [plain(MAX_LOG_LINES + 1)],
      replace: false,
      truncated: false,
      done: false,
    });

    expect(start.truncated).toBe(false);
    expect(next.lines).toHaveLength(MAX_LOG_LINES);
    expect(next.lines[0]?.text).toBe('line 2');
    expect(next.truncated).toBe(true);
  });
});
