import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import type { ClaudeTaskEvent } from '../types/ClaudeTaskEvent';
import { NOTES_STEP } from './fixtures/review';
import type { ReviewScenario } from './review';

const SESSION = 'mock-mr-session-1';

const client = (review: ReviewScenario = {}) => createMockClient({ latencyMs: 0, review });

function recorder<T>() {
  const events: ClaudeTaskEvent<T>[] = [];
  const kinds = () =>
    events.map((e) => (e.kind === 'partialText' ? `partialText:${e.text}` : e.kind));
  return { events, kinds, push: (e: ClaudeTaskEvent<T>) => events.push(e) };
}

describe('mock review backend', () => {
  it('F-09.6 step notes: queued, started, done; opened again from the cache', async () => {
    const mock = client();
    const first = recorder();
    const analysis = await mock.reviewFindings(SESSION, NOTES_STEP, first.push);
    expect(first.kinds()).toEqual(['queued', 'started', 'done']);
    expect(analysis.findings.map((f) => f.id)).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(analysis.findings.map((f) => f.severity)).toEqual(['q', 'fix', 'nit', 'fix']);
    expect(analysis.findings.every((f) => f.decision === 'open')).toBe(true);
    expect(analysis.checklist).toHaveLength(3);

    const again = recorder();
    await mock.reviewFindings(SESSION, NOTES_STEP, again.push);
    expect(again.kinds()).toEqual(['queued', 'done']);
    // Other steps: "Nothing stood out."
    expect((await mock.reviewFindings(SESSION, 's1', () => undefined)).findings).toEqual([]);
  });

  it('F-09.1 each mock note has severity, title, body, line (file, side, line), evidence and a suggested comment, as in Main.dc.html', async () => {
    const mock = client();
    const { findings } = await mock.reviewFindings(SESSION, NOTES_STEP, () => undefined);
    const vm = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
    // Main.dc.html's F[]: severity, line, title and the "Checked in" chip of each note.
    expect(
      findings.map((f) => [f.severity, f.file, f.side, f.line, f.title, f.evidence.length]),
    ).toEqual([
      ['q', vm, 'new', 46, 'The whole photo goes into SQLite as byte[]', 1],
      ['fix', vm, 'new', 49, 'PendingCount won’t refresh after upload', 1],
      ['nit', vm, 'new', 51, 'Status texts are hardcoded', 1],
      ['fix', vm, 'new', 54, 'catch (Exception) also catches camera cancellation', 1],
    ]);
    // The mock's chips abbreviate the folders; the file name and the line are what it shows.
    const chips = findings.map((f) => {
      const [first] = f.evidence;
      return `${(first?.file ?? '').split('/').pop() ?? ''}:${String(first?.line)}`;
    });
    expect(chips[0]).toBe('PendingUpload.cs:5');
    expect(chips[1]).toBe('UploadWorker.cs:58');
    expect(chips[2]).toMatch(/\.resx:\d+$/);
    expect(chips[3]).toBe('CameraService.cs:31');
    for (const f of findings) {
      expect(f.body.length).toBeGreaterThan(40);
      expect(f.suggestedComment.length).toBeGreaterThan(20);
      for (const e of f.evidence) {
        expect(e.file).not.toMatch(/\\|^\//);
        expect(e.line).toBeGreaterThanOrEqual(1);
        expect(e.note.length).toBeGreaterThan(0);
      }
    }
    expect(findings[1]?.body).toBe(
      'The counter is only computed when adding. UploadWorker from step 3 removes items from the queue but never notifies the ViewModel, so the offline banner will show a stale number.',
    );
    expect(findings[1]?.suggestedComment).toBe(
      'Could IUploadQueue publish changes (an event or WeakReferenceMessenger) so the ViewModel refreshes PendingCount after each upload?',
    );
  });

  it('F-09.6 a failing step task sends failed and rejects with CLAUDE_FAILED', async () => {
    const mock = client({ stepFails: true });
    const run = recorder();
    await expect(mock.reviewFindings(SESSION, NOTES_STEP, run.push)).rejects.toMatchObject({
      code: 'CLAUDE_FAILED',
      retryable: true,
    });
    expect(run.kinds()).toEqual(['queued', 'started', 'failed']);
  });

  it('F-09.2 add to drafts, dismiss and undo; decisions survive reopening the step', async () => {
    const mock = client();
    await mock.reviewFindings(SESSION, NOTES_STEP, () => undefined);

    const added = await mock.reviewDecide('f2', { kind: 'addToDrafts' });
    expect(added.finding.decision).toBe('draft');
    expect(added.draft).toMatchObject({
      sessionId: SESSION,
      findingId: 'f2',
      body: added.finding.suggestedComment,
      position: { file: added.finding.file, side: 'new', line: 49 },
      severity: 'fix',
      include: true,
    });
    const edited = await mock.reviewDecide('f4', { kind: 'editAndAdd', body: 'Catch it apart?' });
    expect(edited.draft?.body).toBe('Catch it apart?');
    const dismissed = await mock.reviewDecide('f3', { kind: 'dismiss' });
    expect(dismissed).toMatchObject({ finding: { decision: 'dismissed' }, draft: null });
    expect((await mock.draftsList(SESSION)).map((d) => d.findingId)).toEqual(['f2', 'f4']);

    await expect(mock.reviewDecide('f2', { kind: 'dismiss' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(mock.reviewDecide('nope', { kind: 'dismiss' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'This note no longer exists.',
    });

    const reopened = await mock.reviewFindings(SESSION, NOTES_STEP, () => undefined);
    expect(reopened.findings.map((f) => f.decision)).toEqual([
      'open',
      'draft',
      'dismissed',
      'draft',
    ]);

    await mock.reviewDecide('f2', { kind: 'undo' });
    await mock.reviewDecide('f3', { kind: 'undo' });
    expect((await mock.draftsList(SESSION)).map((d) => d.findingId)).toEqual(['f4']);
    await expect(mock.reviewDecide('f3', { kind: 'undo' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('F-09.2 local drafts: create, update, delete with the core’s error copy', async () => {
    const mock = client();
    await expect(
      mock.draftsCreate({
        sessionId: SESSION,
        findingId: null,
        body: '  ',
        position: null,
        severity: null,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', message: 'Write a comment first.' });

    const draft = await mock.draftsCreate({
      sessionId: SESSION,
      findingId: null,
      body: 'Why a queue here?',
      position: null,
      severity: null,
    });
    expect(draft).toMatchObject({ include: true, publishedNoteId: null, error: null });
    const updated = await mock.draftsUpdate(draft.id, { body: null, include: false });
    expect(updated).toMatchObject({ body: 'Why a queue here?', include: false });
    expect(await mock.draftsList('another-session')).toEqual([]);

    await mock.draftsDelete(draft.id);
    expect(await mock.draftsList(SESSION)).toEqual([]);
    await expect(mock.draftsDelete(draft.id)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'This draft no longer exists.',
    });
  });

  it('F-10.2 a question streams partialText pieces, then done; the next one is a follow-up', async () => {
    const mock = client();
    const run = recorder();
    const answer = await mock.reviewAsk(SESSION, NOTES_STEP, 'Why a queue?', null, run.push);
    const kinds = run.kinds();
    expect(kinds.slice(0, 2)).toEqual(['queued', 'started']);
    expect(kinds.at(-1)).toBe('done');
    const streamed = run.events.flatMap((e) => (e.kind === 'partialText' ? [e.text] : []));
    expect(streamed.length).toBeGreaterThan(1);
    expect(answer).toEqual({ text: streamed.join('').trim(), followUp: false });

    const followUp = await mock.reviewAsk(
      SESSION,
      NOTES_STEP,
      'And offline?',
      null,
      () => undefined,
    );
    expect(followUp.followUp).toBe(true);
    await expect(
      mock.reviewAsk(SESSION, NOTES_STEP, ' ', null, () => undefined),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
