import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockClient } from '.';
import type { IpcClient } from '../client';
import type { Draft } from '../types/Draft';

// F-12.7: the mock backend keeps drafts per MR (project + iid) the way the core does
// (`drafts::attach_to_mr`, M5 decision 15). `draftsCreateForMr(project, iid, { body, position,
// severity })` is for the drafts made outside a review (Explain failure on S-08, Add as a question
// on S-12): the draft joins the latest session of that MR, else a "drafts only" session is created.
// Such a session is listed by sessionsListUnfinished (status 'draftsOnly', resume S-05, the draft
// count and no steps) while it holds an unpublished draft. Opening a review of the MR moves the
// unpublished drafts of the MR's older sessions into the new session; published ones stay.

const ignore = () => undefined;
const PROJECT = 'mobile/mobile-app';
const MESSAGE = 'Is the keystore secret set for this branch?';

const question = (body: string) => ({ body, position: null, severity: 'q' as const });

/** Opens !482 and returns the session and the project the mock reviews it in. */
async function openMr(ipc: IpcClient) {
  const { sessionId } = await ipc.sessionOpenMr(482, null, 'task', ignore);
  const source = await ipc.sessionSource(sessionId);
  if (source.kind !== 'mr') throw new Error('not an MR session');
  return { sessionId, project: source.project };
}

const listed = async (ipc: IpcClient) => await ipc.sessionsListUnfinished();

afterEach(() => {
  vi.useRealTimers();
});

describe('mock drafts of the MR (F-12.7)', () => {
  it('F-12.7 a draft for an MR without a session creates a drafts-only session that Pick up lists', async () => {
    const ipc = createMockClient({ latencyMs: 0 });

    const draft = await ipc.draftsCreateForMr(PROJECT, 482, question(MESSAGE));

    expect(draft).toMatchObject({
      body: MESSAGE,
      severity: 'q',
      position: null,
      findingId: null,
      stepId: null,
      include: true,
      publishedNoteId: null,
      error: null,
      outdated: false,
    });
    expect(await ipc.draftsList(draft.sessionId)).toEqual([draft]);
    expect(await ipc.sessionSource(draft.sessionId)).toEqual({
      kind: 'mr',
      project: PROJECT,
      iid: 482,
    });
    const cards = await listed(ipc);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: draft.sessionId,
      status: 'draftsOnly',
      source: { kind: 'mr', project: PROJECT, iid: 482 },
      // No MR title is known for the card: the project, as the core's `card_title` falls back.
      title: PROJECT,
      drafts: 1,
      reviewedSteps: 0,
      totalSteps: 0,
      // Continue opens S-05, whatever screen was open last.
      resume: { screen: 'S-05', sessionId: draft.sessionId },
    });
  });

  it('F-12.7 later drafts of the MR join the drafts-only session; another iid or project gets its own', async () => {
    const ipc = createMockClient({ latencyMs: 0 });

    const first = await ipc.draftsCreateForMr(PROJECT, 482, question('First'));
    const second = await ipc.draftsCreateForMr(PROJECT, 482, question('Second'));
    const otherIid = await ipc.draftsCreateForMr(PROJECT, 483, question('Other iid'));
    const otherProject = await ipc.draftsCreateForMr('mobile/courier-app', 482, question('Other'));

    expect(second.sessionId).toBe(first.sessionId);
    expect((await ipc.draftsList(first.sessionId)).map((d) => d.body)).toEqual(['First', 'Second']);
    expect(new Set([first, otherIid, otherProject].map((d) => d.sessionId)).size).toBe(3);
    const cards = await listed(ipc);
    expect(cards.map((c) => [c.id, c.drafts]).sort()).toEqual(
      [
        [first.sessionId, 2],
        [otherIid.sessionId, 1],
        [otherProject.sessionId, 1],
      ].sort(),
    );
  });

  it('F-12.7 a draft keeps the position and severity it was made with', async () => {
    const ipc = createMockClient({ latencyMs: 0 });
    const position = {
      file: 'src/Mobile.App/Views/DeliveryPhotoPage.xaml',
      side: 'new' as const,
      line: 12,
    };

    const draft = await ipc.draftsCreateForMr(PROJECT, 482, {
      body: 'Does anything outside this MR still bind to `PendingCount`?',
      position,
      severity: 'nit',
    });

    expect(draft).toMatchObject({ position, severity: 'nit', include: true });
  });

  it('F-12.7 a draft for an MR with review sessions joins the latest of them and creates no session', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T08:00:00Z'));
    const ipc = createMockClient({ latencyMs: 0 });
    const older = await openMr(ipc);
    vi.setSystemTime(new Date('2026-10-14T09:00:00Z'));
    const latest = await openMr(ipc);
    expect(latest.sessionId).not.toBe(older.sessionId);

    const draft = await ipc.draftsCreateForMr(older.project, 482, question(MESSAGE));

    expect(draft.sessionId).toBe(latest.sessionId);
    expect(await ipc.draftsList(latest.sessionId)).toEqual([draft]);
    expect(await ipc.draftsList(older.sessionId)).toEqual([]);
    const cards = await listed(ipc);
    expect(cards.map((c) => c.id).sort()).toEqual([older.sessionId, latest.sessionId].sort());
    expect(cards.find((c) => c.id === latest.sessionId)).toMatchObject({
      status: 'planning',
      drafts: 1,
    });
  });

  it('F-12.7 a blank draft is refused and creates no session', async () => {
    const ipc = createMockClient({ latencyMs: 0 });

    await expect(ipc.draftsCreateForMr(PROJECT, 482, question('   '))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Write a comment first.',
    });

    expect(await listed(ipc)).toEqual([]);
  });

  it('F-12.7 a drafts-only session leaves Pick up once its drafts are deleted or published, and keeps its published rows', async () => {
    const ipc = createMockClient({ latencyMs: 0 });
    const gone = await ipc.draftsCreateForMr(PROJECT, 483, question('Delete me'));
    const sent = await ipc.draftsCreateForMr(PROJECT, 482, question('Publish me'));
    expect(await listed(ipc)).toHaveLength(2);

    await ipc.draftsDelete(gone.id);
    expect((await listed(ipc)).map((c) => c.id)).toEqual([sent.sessionId]);

    const outcome = await ipc.draftsPublish(sent.sessionId, [sent.id], null);
    expect(outcome.published).toEqual([sent.id]);
    expect(await listed(ipc)).toEqual([]);
    // S-05 still shows the published row of the session.
    const rows = await ipc.draftsList(sent.sessionId);
    expect(rows.map((d) => [d.id, d.publishedNoteId !== null])).toEqual([[sent.id, true]]);
  });

  it('F-12.7 opening a review of the MR moves the unpublished drafts of its drafts-only session into it', async () => {
    const ipc = createMockClient({ latencyMs: 0 });
    const sent = await ipc.draftsCreateForMr(PROJECT, 482, question('Already published'));
    const waiting = await ipc.draftsCreateForMr(PROJECT, 482, question(MESSAGE));
    const other = await ipc.draftsCreateForMr(PROJECT, 483, question('Another MR'));
    await ipc.draftsPublish(sent.sessionId, [sent.id], null);
    const published = (await ipc.draftsList(sent.sessionId)).find((d) => d.id === sent.id);

    const opened = await ipc.sessionOpenMr(482, null, 'task', ignore);

    expect(opened.sessionId).not.toBe(sent.sessionId);
    // Moved, not copied: the same draft with the new session; the published row stays behind.
    expect(await ipc.draftsList(opened.sessionId)).toEqual([
      { ...waiting, sessionId: opened.sessionId },
    ]);
    expect(await ipc.draftsList(sent.sessionId)).toEqual([published]);
    expect(await ipc.draftsList(other.sessionId)).toEqual([other]);
    const cards = await listed(ipc);
    expect(cards.map((c) => [c.id, c.status, c.drafts]).sort()).toEqual(
      [
        [opened.sessionId, 'planning', 1],
        [other.sessionId, 'draftsOnly', 1],
      ].sort(),
    );
  });

  it('F-12.7 opening another review of the MR moves the unpublished drafts of the older review into it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T08:00:00Z'));
    const ipc = createMockClient({ latencyMs: 0 });
    const older = await openMr(ipc);
    const kept: Draft = await ipc.draftsCreate({
      sessionId: older.sessionId,
      findingId: null,
      body: 'Should be awaited.',
      position: {
        file: 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs',
        side: 'new',
        line: 41,
      },
      severity: 'fix',
    });
    vi.setSystemTime(new Date('2026-10-14T09:00:00Z'));

    const latest = await openMr(ipc);

    expect(await ipc.draftsList(latest.sessionId)).toEqual([
      { ...kept, sessionId: latest.sessionId },
    ]);
    expect(await ipc.draftsList(older.sessionId)).toEqual([]);
    const cards = await listed(ipc);
    expect(cards.find((c) => c.id === latest.sessionId)?.drafts).toBe(1);
    expect(cards.find((c) => c.id === older.sessionId)?.drafts).toBe(0);
  });

  it('F-12.7 a drafts-only session and its drafts survive the app starting again', async () => {
    const saved = new Map<string, string>();
    const storage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value);
      },
    };
    const before = createMockClient({ latencyMs: 0, storage });
    const draft = await before.draftsCreateForMr(PROJECT, 482, question(MESSAGE));

    const after = createMockClient({ latencyMs: 0, storage });

    expect(await after.draftsList(draft.sessionId)).toEqual([draft]);
    expect((await listed(after)).map((c) => [c.id, c.status, c.drafts])).toEqual([
      [draft.sessionId, 'draftsOnly', 1],
    ]);
    // The app starts on the summary it was on (F-30.4): the session exists for the start route.
    const summary = { screen: 'S-05', sessionId: draft.sessionId } as const;
    await after.appSettingsSet({ ui: { lastRoute: summary } });
    expect(await after.appStartRoute()).toEqual(summary);
    // A draft made after the restart joins the same session.
    const next = await after.draftsCreateForMr(PROJECT, 482, question('Another'));
    expect(next.sessionId).toBe(draft.sessionId);
  });
});
