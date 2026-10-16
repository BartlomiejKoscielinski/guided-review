import type { AnalysisStatus } from '../types/AnalysisStatus';
import type { CodeAt } from '../types/CodeAt';
import { branchCommits } from './fixtures/sources';
import { sessionMrRow } from './prepare';
import type { SessionData } from './session-data';

/** The head of !482's review worktree, as the footer of Main.dc.html shows it (F-08.8). */
export const MOCK_WORKTREE_HEAD = 'a3f9c12b7e4d6f8091a2b3c4d5e6f708192a3b4c';

/**
 * The mock's step runs by `session\0step`, as the core's `StepRuns`: the ones `claude` is
 * analyzing now and the ones whose last run failed (a run that succeeds clears it).
 */
export interface MockStepRuns {
  running: Set<string>;
  failed: Set<string>;
}

export const createStepRuns = (): MockStepRuns => ({ running: new Set(), failed: new Set() });

export const runKey = (sessionId: string, stepId: string) => `${sessionId}\0${stepId}`;

/** The code Claude reads (M4 decision 10): the commit a short sha names, else the sha itself. */
function codeAt(data: SessionData, sessionId: string): CodeAt {
  const source = data.sources[sessionId];
  if (!source) {
    return sessionMrRow(data, sessionId)
      ? { kind: 'worktree', sha: MOCK_WORKTREE_HEAD }
      : { kind: 'workingTree' };
  }
  switch (source.kind) {
    case 'mr':
      return { kind: 'worktree', sha: MOCK_WORKTREE_HEAD };
    case 'commits': {
      const to = source.to.toLowerCase();
      const sha = branchCommits().find((c) => c.sha.startsWith(to))?.sha ?? source.to;
      return { kind: 'repository', sha };
    }
    case 'local':
      return { kind: 'workingTree' };
  }
}

/**
 * `review_analysis_status` of a planned session whose steps come in `order`: running wins over
 * ready (analyzed, Claude's cache), ready over failed, as in the core (review/analysis_status.rs).
 */
export function analysisStatus(
  data: SessionData,
  runs: MockStepRuns,
  sessionId: string,
  order: string[],
): AnalysisStatus {
  const status: AnalysisStatus = {
    ready: [],
    running: [],
    failed: [],
    codeAt: codeAt(data, sessionId),
  };
  for (const stepId of order) {
    const key = runKey(sessionId, stepId);
    if (runs.running.has(key)) status.running.push(stepId);
    else if (data.analyzed.includes(key)) status.ready.push(stepId);
    else if (runs.failed.has(key)) status.failed.push(stepId);
  }
  return status;
}
