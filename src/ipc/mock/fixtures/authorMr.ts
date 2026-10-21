import type { AuthorMr } from '../../types/AuthorMr';

/** My MR in the mock backend (Author.dc.html). */
export const AUTHOR_MR = 480;

const MINUTE = 60_000;

/**
 * !480 as `author_mr` answers it (Author.dc.html): Marta K.'s change request and Piotr S.'s
 * question, open, in GitLab's order, and one thread resolved earlier. The head pipeline #18338
 * passed; it started 40 minutes before the client loaded.
 */
export function authorMr(now: Date = new Date()): AuthorMr {
  return {
    iid: AUTHOR_MR,
    title: 'Retry in UploadWorker after network loss',
    sourceBranch: 'feature/upload-retry',
    targetBranch: 'develop',
    pipeline: {
      status: 'passed',
      allowedFailures: 0,
      number: 18338,
      kind: 'Merge request pipeline',
      sha: '9e1d4b7c2a5f8e0d3b6a9c1e4f7a0d2b5c8e1f40',
      version: 2,
      author: 'Bartek K.',
      startedByMe: true,
      startedAt: new Date(now.getTime() - 40 * MINUTE).toISOString(),
      durationSecs: 11 * 60,
      webUrl: null,
    },
    threads: [
      {
        id: 'author-t1',
        author: 'Marta K.',
        avatar: 'MK',
        place: 'UploadWorker.cs:46',
        excerpt:
          'The delay grows linearly. Can we make it exponential with a cap? With MaxAttempts raised later we’d hammer the API.',
        kind: 'change',
        status: 'changeRequested',
      },
      {
        id: 'author-t2',
        author: 'Piotr S.',
        avatar: 'PS',
        place: 'UploadWorker.cs:36',
        excerpt:
          'What happens if the app is killed in the middle of retrying? Do we lose the attempt count?',
        kind: 'question',
        status: 'question',
      },
    ],
    toAnswer: 2,
    resolved: { count: 1, firstExcerpt: 'typo in a log message' },
  };
}
