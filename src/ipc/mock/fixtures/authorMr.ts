import type { AuthorMr } from '../../types/AuthorMr';
import type { MockFile } from './changes';

/** My MR in the mock backend (Author.dc.html). */
export const AUTHOR_MR = 480;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The file both threads of !480 sit in. */
export const UPLOAD_WORKER = 'src/App/Workers/UploadWorker.cs';

const MARTA =
  'The delay grows linearly. Can we make it exponential with a cap? With MaxAttempts raised later we’d hammer the API.';
const PIOTR =
  'What happens if the app is killed in the middle of retrying? Do we lose the attempt count?';

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
        path: UPLOAD_WORKER,
        line: 46,
        excerpt: MARTA,
        kind: 'change',
        status: 'changeRequested',
        notes: [
          {
            author: 'Marta K.',
            avatar: 'MK',
            body: MARTA,
            createdAt: new Date(now.getTime() - 3 * HOUR).toISOString(),
            mine: false,
          },
        ],
      },
      {
        id: 'author-t2',
        author: 'Piotr S.',
        avatar: 'PS',
        place: 'UploadWorker.cs:36',
        path: UPLOAD_WORKER,
        line: 36,
        excerpt: PIOTR,
        kind: 'question',
        status: 'question',
        notes: [
          {
            author: 'Piotr S.',
            avatar: 'PS',
            body: PIOTR,
            createdAt: new Date(now.getTime() - 2 * HOUR).toISOString(),
            mine: false,
          },
        ],
      },
    ],
    toAnswer: 2,
    resolved: { count: 1, firstExcerpt: 'typo in a log message' },
  };
}

/**
 * UploadWorker.cs from merge-base(origin/develop, HEAD) to the working tree (Author.dc.html, before
 * a fix): the retry loop with the linear delay at line 46 that Marta K. comments on.
 */
export const UPLOAD_WORKER_DIFF: MockFile = {
  path: UPLOAD_WORKER,
  status: 'modified',
  hunks: [
    {
      id: `${UPLOAD_WORKER}#h1`,
      header: '@@ -30,8 +30,20 @@ public sealed class UploadWorker',
      rows: [
        ['c', 30, 30, 'public async Task RunAsync(CancellationToken ct)'],
        ['c', 31, 31, '{'],
        ['c', 32, 32, '    while (!ct.IsCancellationRequested)'],
        ['c', 33, 33, '    {'],
        ['c', 34, 34, '        var item = await _queue.PeekAsync(ct);'],
        ['c', 35, 35, '        if (item is null) { await _signal.WaitAsync(ct); continue; }'],
        ['d', 36, '        await _api.UploadPhotoAsync(item.DeliveryId, item.Bytes, ct);'],
        ['a', 36, '        var attempt = 0;'],
        ['a', 37, '        while (true)'],
        ['a', 38, '        {'],
        ['a', 39, '            try'],
        ['a', 40, '            {'],
        ['a', 41, '                await _api.UploadPhotoAsync(item.DeliveryId, item.Bytes, ct);'],
        ['a', 42, '                break;'],
        ['a', 43, '            }'],
        ['a', 44, '            catch (HttpRequestException) when (++attempt < MaxAttempts)'],
        ['a', 45, '            {'],
        ['a', 46, '                await Task.Delay(1000 * attempt, ct);'],
        ['a', 47, '            }'],
        ['a', 48, '        }'],
        ['c', 37, 49, '        await _queue.RemoveAsync(item.Id, ct);'],
      ],
    },
  ],
};
