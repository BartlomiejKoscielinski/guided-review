import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { AskAnswer } from '../types/AskAnswer';
import type { ClaudeTaskEvent } from '../types/ClaudeTaskEvent';
import type { Decision } from '../types/Decision';
import type { Draft } from '../types/Draft';
import type { Finding } from '../types/Finding';
import type { StepAnalysis } from '../types/StepAnalysis';
import { ANSWER_PARTS, stepAnalysis } from './fixtures/review';

/** Variations of S-02's and S-03's Claude tasks (`MOCK_REVIEW_KEY`). */
export interface ReviewScenario {
  /** The plan task fails: S-02's Claude failed state (F-06.13 risk still shown). */
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

/**
 * Steps, questions, decisions and local drafts of the mock backend (F-09, F-10): the core's
 * event order (`queued`, `started` unless already analyzed, `partialText`, `done`/`failed`),
 * the same decision rules and the same error copy. Nothing reaches GitLab.
 */
export function createReviewBackend(
  scenario: ReviewScenario,
  respond: <T>(value: T) => Promise<T>,
  pause: (ms: number) => Promise<void>,
): ReviewClient {
  const analyzed = new Set<string>();
  const asked = new Set<string>();
  const notes = new Map<string, { finding: Finding; sessionId: string }>();
  let drafts: Draft[] = [];
  let nextDraft = 1;

  const withDecision = (sessionId: string, finding: Finding): Finding => {
    const stored = notes.get(finding.id);
    if (stored) return stored.finding;
    notes.set(finding.id, { finding, sessionId });
    return finding;
  };

  const setDecision = (id: string, decision: Decision): Finding => {
    const stored = notes.get(id);
    if (!stored) throw error('INVALID_INPUT', 'This note no longer exists.');
    stored.finding = { ...stored.finding, decision };
    return stored.finding;
  };

  const findDraft = (id: string): Draft => {
    const draft = drafts.find((d) => d.id === id);
    if (!draft) throw error('INVALID_INPUT', 'This draft no longer exists.');
    if (draft.publishedNoteId !== null) {
      throw error('CONFLICT', 'This draft is already on GitLab; change it there.');
    }
    return draft;
  };

  const createDraft = (draft: Omit<Draft, 'id' | 'include' | 'publishedNoteId' | 'error'>) => {
    if (draft.body.trim() === '') throw error('INVALID_INPUT', 'Write a comment first.');
    const created: Draft = {
      ...draft,
      id: `mock-draft-${String(nextDraft++)}`,
      include: true,
      publishedNoteId: null,
      error: null,
    };
    drafts = [...drafts, created];
    return created;
  };

  return {
    reviewFindings: async (sessionId, stepId, onEvent) => {
      const key = `${sessionId}\0${stepId}`;
      onEvent({ kind: 'queued' });
      if (!analyzed.has(key)) {
        onEvent({ kind: 'started' });
        await pause(MOCK_STEP_MS);
        if (scenario.stepFails) {
          const failure = error('CLAUDE_FAILED', 'Claude Code failed.', true);
          onEvent({
            kind: 'failed',
            error: { code: failure.code, message: failure.message, retryable: true },
          });
          throw failure;
        }
        analyzed.add(key);
      }
      const analysis = stepAnalysis(stepId);
      const result: StepAnalysis = {
        ...analysis,
        findings: analysis.findings.map((f) => withDecision(sessionId, f)),
      };
      onEvent({ kind: 'done', result: structuredClone(result) });
      return respond(result);
    },
    reviewAsk: async (sessionId, stepId, question, _selection, onEvent) => {
      if (question.trim() === '') throw error('INVALID_INPUT', 'Type a question first.');
      const key = `${sessionId}\0${stepId}`;
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
    reviewDecide: (findingId, decision) => {
      const stored = notes.get(findingId);
      if (!stored) return Promise.reject(error('INVALID_INPUT', 'This note no longer exists.'));
      const { finding, sessionId } = stored;
      const changed = () => error('CONFLICT', 'This note changed in the meantime.');
      try {
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
            return respond({ finding: setDecision(findingId, 'draft'), draft });
          }
          case 'dismiss':
            if (finding.decision !== 'open') throw changed();
            return respond({ finding: setDecision(findingId, 'dismissed'), draft: null });
          case 'undo':
            if (finding.decision === 'open') throw changed();
            drafts = drafts.filter((d) => d.findingId !== findingId);
            return respond({ finding: setDecision(findingId, 'open'), draft: null });
        }
      } catch (e: unknown) {
        return Promise.reject(e instanceof Error ? e : changed());
      }
    },
    draftsList: (sessionId) => respond(drafts.filter((d) => d.sessionId === sessionId)),
    draftsCreate: (draft) => {
      try {
        return respond(createDraft(draft));
      } catch (e: unknown) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
    draftsUpdate: (id, patch) => {
      try {
        const draft = findDraft(id);
        if (patch.body !== null && patch.body.trim() === '') {
          throw error('INVALID_INPUT', 'Write a comment first.');
        }
        const updated: Draft = {
          ...draft,
          body: patch.body ?? draft.body,
          include: patch.include ?? draft.include,
        };
        drafts = drafts.map((d) => (d.id === id ? updated : d));
        return respond(updated);
      } catch (e: unknown) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
    draftsDelete: (id) => {
      try {
        findDraft(id);
        drafts = drafts.filter((d) => d.id !== id);
        return respond(undefined);
      } catch (e: unknown) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
  };
}
