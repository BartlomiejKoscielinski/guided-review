import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { AskAnswer } from '../types/AskAnswer';
import type { ClaudeTaskEvent } from '../types/ClaudeTaskEvent';
import type { Decision } from '../types/Decision';
import type { Draft } from '../types/Draft';
import type { DiffPosition } from '../types/DiffPosition';
import type { Finding } from '../types/Finding';
import type { NewDraft } from '../types/NewDraft';
import type { StepAnalysis } from '../types/StepAnalysis';
import type { FileDiff } from '../types/FileDiff';
import type { MockStepRuns } from './analysisStatus';
import { mockPlan } from './fixtures/plan';
import { mockFallbackView } from './fixtures/planFallback';
import { ANSWER_PARTS, stepAnalysis } from './fixtures/review';
import { selectionInStep, stepFiles } from './fixtures/step';
import type { MockSessionData, SessionData } from './session-data';

/** Variations of S-02's and S-03's Claude tasks (`MOCK_REVIEW_KEY`). */
export interface ReviewScenario {
  /** The plan task fails: S-02's Claude failed state with the file-order fallback plan. */
  planFails?: boolean;
  /** The first plan comes from the cache: "Plan from cache · <age>" (F-06.12). */
  planCached?: boolean;
  /** The step task fails: "Couldn't analyze this step." with Retry (F-09.6). */
  stepFails?: boolean;
}

type ReviewClient = Pick<
  IpcClient,
  | 'reviewFindings'
  | 'reviewAsk'
  | 'reviewDecide'
  | 'draftsList'
  | 'draftsCreate'
  | 'draftsUpdate'
  | 'draftsDelete'
>;

/** Pause before a step's notes arrive, so "Claude is reading this step…" is visible. */
export const MOCK_STEP_MS = 900;
/** Pause between pieces of a streamed answer. */
export const MOCK_DELTA_MS = 120;

const error = (code: IpcError['code'], message: string, retryable = false) =>
  new IpcError({ code, message, retryable });

const analyzedKey = (sessionId: string, stepId: string) => `${sessionId}\0${stepId}`;

/** The files of a step of the mock plan or of the file-order fallback plan (ids f1, f2, …). */
function filesOfStep(stepId: string): FileDiff[] {
  const fallback = mockFallbackView({ code: 'CLAUDE_FAILED', message: '', retryable: true });
  const step = [...mockPlan().steps, ...fallback.plan.steps].find((s) => s.id === stepId);
  return step ? stepFiles(step) : [];
}

/** The step holding the hunk of a diff line (F-08.3, `drafts::step_at`); null outside every step. */
function stepAtLine(position: DiffPosition): string | null {
  const selection = { ...position, start: position.line, end: position.line };
  const step = mockPlan().steps.find((s) => selectionInStep(filesOfStep(s.id), selection));
  return step?.id ?? null;
}

/** A note's key in `SessionData.notes`: the core keeps notes per session (F-09.4). */
export const noteKey = (sessionId: string, findingId: string) => `${sessionId}\0${findingId}`;

/** The step's notes with the decisions made on them (a note keeps its decision across runs). */
function decided(data: SessionData, sessionId: string, stepId: string): StepAnalysis {
  const analysis = stepAnalysis(stepId);
  return {
    ...analysis,
    findings: analysis.findings.map((f) => {
      const stored = data.notes[noteKey(sessionId, f.id)];
      if (stored) return stored.finding;
      data.notes[noteKey(sessionId, f.id)] = { finding: f, sessionId };
      return f;
    }),
  };
}

/** The step's notes from Claude's cache with their decisions; null when it was never analyzed. */
export function cachedFindings(
  data: SessionData,
  sessionId: string,
  stepId: string,
): StepAnalysis | null {
  return data.analyzed.includes(analyzedKey(sessionId, stepId))
    ? decided(data, sessionId, stepId)
    : null;
}

/**
 * Steps, questions, decisions and local drafts of the mock backend (F-09, F-10): the core's
 * event order (`queued`, `started` unless already analyzed, `partialText`, `done`/`failed`),
 * the same decision rules and the same error copy. Nothing reaches GitLab. Analyzed steps,
 * decisions and drafts are kept in `store`, so they survive a restart (F-04.3).
 */
export function createReviewBackend(
  scenario: ReviewScenario,
  respond: <T>(value: T) => Promise<T>,
  pause: (ms: number) => Promise<void>,
  store: MockSessionData,
  runs: MockStepRuns,
): ReviewClient {
  const { data } = store;
  const asked = new Set<string>();

  const setDecision = (key: string, decision: Decision): Finding => {
    const stored = data.notes[key];
    if (!stored) throw error('INVALID_INPUT', 'This note no longer exists.');
    stored.finding = { ...stored.finding, decision };
    return stored.finding;
  };

  const findDraft = (id: string): Draft => {
    const draft = data.drafts.find((d) => d.id === id);
    if (!draft) throw error('INVALID_INPUT', 'This draft no longer exists.');
    if (draft.publishedNoteId !== null) {
      throw error('CONFLICT', 'This draft is already on GitLab; change it there.');
    }
    return draft;
  };

  /** The step a new draft belongs to (F-08.3): its note's step, else the one holding its line. */
  const stepOf = (draft: NewDraft): string | null => {
    if (draft.findingId !== null) {
      return data.notes[noteKey(draft.sessionId, draft.findingId)]?.finding.stepId ?? null;
    }
    return draft.position ? stepAtLine(draft.position) : null;
  };

  const createDraft = (draft: NewDraft) => {
    if (draft.body.trim() === '') throw error('INVALID_INPUT', 'Write a comment first.');
    const created: Draft = {
      ...draft,
      stepId: stepOf(draft),
      id: `mock-draft-${String(data.nextDraft++)}`,
      include: true,
      publishedNoteId: null,
      error: null,
      outdated: false,
    };
    data.drafts = [...data.drafts, created];
    return created;
  };

  /** Runs a change of the stored data and keeps it; a refused change keeps nothing new. */
  const change = <T>(apply: () => T): Promise<T> => {
    try {
      const result = apply();
      store.save();
      return respond(result);
    } catch (e: unknown) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  };

  return {
    reviewFindings: async (sessionId, stepId, onEvent) => {
      const key = analyzedKey(sessionId, stepId);
      onEvent({ kind: 'queued' });
      if (!data.analyzed.includes(key)) {
        // Running before `started` and settled before the last event, as the core (F-08.8).
        runs.running.add(key);
        onEvent({ kind: 'started' });
        await pause(MOCK_STEP_MS);
        runs.running.delete(key);
        if (scenario.stepFails) {
          const failure = error('CLAUDE_FAILED', 'Claude Code failed.', true);
          runs.failed.add(key);
          onEvent({
            kind: 'failed',
            error: { code: failure.code, message: failure.message, retryable: true },
          });
          throw failure;
        }
        if (!data.analyzed.includes(key)) data.analyzed.push(key);
      }
      runs.failed.delete(key);
      const result = decided(data, sessionId, stepId);
      store.save();
      onEvent({ kind: 'done', result: structuredClone(result) });
      return respond(result);
    },
    reviewAsk: async (sessionId, stepId, question, selection, onEvent) => {
      if (question.trim() === '') throw error('INVALID_INPUT', 'Type a question first.');
      // As the core's `selection_block`: lines no hunk of the step covers start no Claude.
      if (selection && !selectionInStep(filesOfStep(stepId), selection)) {
        throw error('INVALID_INPUT', 'The selected lines are not in this step.');
      }
      const key = analyzedKey(sessionId, stepId);
      const events: ClaudeTaskEvent<AskAnswer>[] = [{ kind: 'queued' }, { kind: 'started' }];
      for (const event of events) onEvent(event);
      for (const text of ANSWER_PARTS) {
        await pause(MOCK_DELTA_MS);
        onEvent({ kind: 'partialText', text });
      }
      const answer: AskAnswer = { text: ANSWER_PARTS.join('').trim(), followUp: asked.has(key) };
      asked.add(key);
      onEvent({ kind: 'done', result: answer });
      return respond(answer);
    },
    reviewDecide: (sessionId, findingId, decision) =>
      change(() => {
        const key = noteKey(sessionId, findingId);
        const stored = data.notes[key];
        if (!stored) throw error('INVALID_INPUT', 'This note no longer exists.');
        const { finding } = stored;
        const changed = () => error('CONFLICT', 'This note changed in the meantime.');
        switch (decision.kind) {
          case 'addToDrafts':
          case 'editAndAdd': {
            if (finding.decision !== 'open') throw changed();
            const draft = createDraft({
              sessionId,
              findingId,
              body: decision.kind === 'editAndAdd' ? decision.body : finding.suggestedComment,
              position: { file: finding.file, side: finding.side, line: finding.line },
              severity: finding.severity,
            });
            return { finding: setDecision(key, 'draft'), draft };
          }
          case 'dismiss':
            if (finding.decision !== 'open') throw changed();
            return { finding: setDecision(key, 'dismissed'), draft: null };
          case 'undo':
            if (finding.decision === 'open') throw changed();
            data.drafts = data.drafts.filter(
              (d) => d.findingId !== findingId || d.sessionId !== sessionId,
            );
            return { finding: setDecision(key, 'open'), draft: null };
        }
      }),
    draftsList: (sessionId) => respond(data.drafts.filter((d) => d.sessionId === sessionId)),
    draftsCreate: (draft) => change(() => createDraft(draft)),
    draftsUpdate: (id, patch) =>
      change(() => {
        const draft = findDraft(id);
        if (patch.body !== null && patch.body.trim() === '') {
          throw error('INVALID_INPUT', 'Write a comment first.');
        }
        const updated: Draft = {
          ...draft,
          body: patch.body ?? draft.body,
          include: patch.include ?? draft.include,
        };
        data.drafts = data.drafts.map((d) => (d.id === id ? updated : d));
        return updated;
      }),
    draftsDelete: (id) =>
      change(() => {
        findDraft(id);
        data.drafts = data.drafts.filter((d) => d.id !== id);
        return undefined;
      }),
  };
}
