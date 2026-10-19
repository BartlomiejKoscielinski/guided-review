import type { IpcClient } from '../client';
import { IpcError } from '../errors';
import type { JobExplanation } from '../types/JobExplanation';
import type { FoundJob } from './pipelineLog';

/** How long the mock prepares the code, then reads, so dev:mock shows both lines. */
export const MOCK_EXPLAIN_PREPARE_MS = 300;
export const MOCK_EXPLAIN_READ_MS = 900;

/** The design mock's EX table (Pipeline.dc.html), by pipeline id and job name. */
const EXPLAINED: Record<string, JobExplanation> = {
  '18342:ui-tests:android': {
    verdict: 'causedByMr',
    title: 'The test looks for “OfflineBanner”, the page now calls it “OfflineStatusBanner”',
    explanation:
      'Step 5 renamed the banner’s AutomationId. The UI test still waits for the old id, so it times out every time. A retry won’t help. The job is allowed to fail, which is why the pipeline still shows as passed.',
    evidence: ['DeliveryPhotoPage.xaml:14', 'DeliveryPhotoPageTests.cs:41'],
    retryRecommended: false,
    suggestedComment:
      'ui-tests:android fails because the banner’s AutomationId changed to OfflineStatusBanner. Could you update DeliveryPhotoPageTests (L41) in this MR?',
  },
  '18321:unit-tests': {
    verdict: 'alreadyFixed',
    fixedInVersion: 3,
    title: 'Queue returned items by Id instead of CreatedAt',
    explanation:
      'Both failing tests check the queue order. Commit a3f9c12 (version 3) sorts by CreatedAt, and the same tests pass in pipeline #18342.',
    evidence: ['SqliteUploadQueue.cs:88', 'pipeline #18342'],
    retryRecommended: false,
    suggestedComment: '',
  },
};

/** Any other failed job: the log shows too little. */
const UNKNOWN: JobExplanation = {
  verdict: 'unknown',
  title: 'The log doesn’t show why this job failed',
  explanation:
    'The job stopped without a failing test or an error line Claude could tie to a change.',
  evidence: [],
  retryRecommended: false,
  suggestedComment: '',
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * `jobExplain` (F-20.7) as `commands/job_explain.rs` answers it: no GitLab account first, an
 * unknown job GitLab's 404, a job that did not fail INVALID_INPUT; then `preparing`, `reading`
 * and `done` with the design mock's answer for the job (else Unknown).
 */
export function createExplainBackend(
  user: () => unknown,
  unauthorized: () => IpcError,
  notFound: () => IpcError,
  find: (job: number) => FoundJob | null,
): Pick<IpcClient, 'jobExplain'> {
  return {
    jobExplain: async (_project, _iid, job, onEvent) => {
      if (!user()) throw unauthorized();
      const found = find(job);
      if (!found) throw notFound();
      if (found.row.state !== 'failed' && found.row.state !== 'failedAllowed') {
        throw new IpcError({
          code: 'INVALID_INPUT',
          message: 'Only a failed job can be explained.',
          retryable: false,
        });
      }
      onEvent({ kind: 'preparing' });
      await wait(MOCK_EXPLAIN_PREPARE_MS);
      onEvent({ kind: 'reading' });
      await wait(MOCK_EXPLAIN_READ_MS);
      const result = EXPLAINED[`${String(found.pipeline)}:${found.row.name}`] ?? UNKNOWN;
      onEvent({ kind: 'done', result });
      return { ...result, evidence: [...result.evidence] };
    },
  };
}
