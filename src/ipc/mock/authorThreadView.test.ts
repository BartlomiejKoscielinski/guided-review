import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import type { FileDiff } from '../types/FileDiff';

// F-26.2 in the mock backend, as the core answers it (plan M7, decision 6): the rows of
// `authorMr(project, iid)` carry `path` (the thread's file, repository-relative, or null on a
// General thread), `line` (its line in the working tree's file, or null) and `notes` (the
// conversation in order: { author (display name), avatar (initials), body, createdAt (ISO),
// mine }); `authorFileDiff(target, path)` is the file's unified diff from merge-base(
// origin/<target>, HEAD) to the working tree, empty (no hunks) for a file the author didn't
// change. Author.dc.html's !480:
//   Marta K.  src/App/Workers/UploadWorker.cs:46  "The delay grows linearly. …"  3 h ago
//   Piotr S.  src/App/Workers/UploadWorker.cs:36  "What happens if the app is killed …"  2 h ago

const PROJECT = 'mobile/mobile-app';
const MINE = 480;
const PATH = 'src/App/Workers/UploadWorker.cs';

async function backend() {
  const mock = createMockClient({ latencyMs: 0 });
  await mock.repoPick();
  return mock;
}

const lines = (diff: FileDiff) => diff.hunks.flatMap((h) => h.lines);

describe('mock author threads (F-26.2)', () => {
  it('F-26.2 the two threads carry the file, the line and the conversation of Author.dc.html', async () => {
    const mock = await backend();

    const { threads } = await mock.authorMr(PROJECT, MINE);

    const [marta, piotr] = threads;
    expect([marta?.path, marta?.line]).toEqual([PATH, 46]);
    expect([piotr?.path, piotr?.line]).toEqual([PATH, 36]);
    expect(marta?.notes).toHaveLength(1);
    expect(marta?.notes[0]).toMatchObject({ author: 'Marta K.', avatar: 'MK', mine: false });
    expect(marta?.notes[0]?.body).toBe(
      'The delay grows linearly. Can we make it exponential with a cap? With MaxAttempts raised later we’d hammer the API.',
    );
    expect(piotr?.notes[0]).toMatchObject({ author: 'Piotr S.', avatar: 'PS', mine: false });
    expect(piotr?.notes[0]?.body).toBe(
      'What happens if the app is killed in the middle of retrying? Do we lose the attempt count?',
    );
  });

  it('F-26.2 the notes are 3 h and 2 h old when the client loads', async () => {
    const mock = await backend();

    const { threads } = await mock.authorMr(PROJECT, MINE);

    const hours = (iso: string | undefined) =>
      Math.round((Date.now() - new Date(iso ?? '').getTime()) / 3_600_000);
    expect(hours(threads[0]?.notes[0]?.createdAt)).toBe(3);
    expect(hours(threads[1]?.notes[0]?.createdAt)).toBe(2);
  });

  it('F-26.2 authorFileDiff gives the unified diff of UploadWorker.cs with the lines of the mock', async () => {
    const mock = await backend();

    const diff = await mock.authorFileDiff('develop', PATH);

    const all = lines(diff);
    const at = (kind: string, no: number) =>
      all.find((l) => l.kind === kind && (kind === 'del' ? l.oldNo : l.newNo) === no);
    expect(at('del', 36)?.text).toBe(
      '        await _api.UploadPhotoAsync(item.DeliveryId, item.Bytes, ct);',
    );
    expect(at('add', 36)?.text).toBe('        var attempt = 0;');
    expect(at('add', 46)?.text).toBe('                await Task.Delay(1000 * attempt, ct);');
    expect(at('ctx', 49)?.text).toBe('        await _queue.RemoveAsync(item.Id, ct);');
    expect(at('ctx', 49)?.oldNo).toBe(37);
    expect(diff.hunks[0]?.newStart).toBe(30);
  });

  it('F-26.2 a file the author did not change has an empty diff', async () => {
    const mock = await backend();

    const diff = await mock.authorFileDiff('develop', 'src/App/Other.cs');

    expect(diff.hunks).toEqual([]);
    expect([diff.additions, diff.deletions]).toEqual([0, 0]);
  });
});
