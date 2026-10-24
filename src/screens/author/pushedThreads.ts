import type { BlockColor } from '../../components/colors';
import type { AuthorMr } from '../../ipc/types/AuthorMr';
import type { AuthorNote } from '../../ipc/types/AuthorNote';
import type { AuthorThread } from '../../ipc/types/AuthorThread';
import type { ResolvedSummary } from '../../ipc/types/ResolvedSummary';
import type { AuthorCommitDraft } from '../../state/authorCommit';
import { STATUS_TAG } from './authorText';

type Drafts = Record<string, AuthorCommitDraft | undefined>;

/** The tag word and colour of a thread in S-10's list. */
export interface ThreadTag {
  word: string;
  color: BlockColor;
}

const RESOLVED_TAG: ThreadTag = { word: 'Resolved', color: 'green' };

const pushed = (draft: AuthorCommitDraft | undefined) => draft?.push === 'done';
const resolvedHere = (draft: AuthorCommitDraft | undefined) =>
  pushed(draft) && draft?.resolve === true;
/** Pushing with Resolve on counts too: GitLab's list can be read again before the push answers. */
const resolving = (draft: AuthorCommitDraft | undefined) =>
  (draft?.push === 'pushing' || draft?.push === 'done') && draft.resolve;
const answered = (thread: AuthorThread) =>
  thread.status === 'replied' || thread.status === 'answered';

/**
 * The thread's tag (Author.dc.html `statusOf`): after its Push and reply in this visit (F-26.6)
 * "Resolved" (green) with Resolve on, else "Replied" ("Answered" for a question GitLab lists so),
 * whatever the list read before the push; otherwise its status.
 */
export function tagOf(thread: AuthorThread, draft: AuthorCommitDraft | undefined): ThreadTag {
  if (!pushed(draft)) return STATUS_TAG[thread.status];
  if (resolvedHere(draft)) return RESOLVED_TAG;
  return thread.status === 'answered' ? STATUS_TAG.answered : STATUS_TAG.replied;
}

/**
 * The list after a reload (F-26.6): GitLab's open threads, plus the threads of `previous` that a
 * push in this visit resolved (or is resolving), at their place, so the one just pushed stays
 * listed and selected with its panel.
 */
export function keepPushed(
  previous: AuthorThread[],
  next: AuthorThread[],
  drafts: Drafts,
): AuthorThread[] {
  const result = [...next];
  previous.forEach((thread, i) => {
    if (next.some((n) => n.id === thread.id) || !resolving(drafts[thread.id])) return;
    const after = new Set(previous.slice(i + 1).map((p) => p.id));
    const at = result.findIndex((r) => after.has(r.id));
    result.splice(at < 0 ? result.length : at, 0, thread);
  });
  return result;
}

/** The heading's count and the "resolved earlier" line of this visit. */
export interface VisitCounts {
  toAnswer: number;
  resolved: ResolvedSummary;
}

/**
 * The counts S-10 shows with `listed` (F-26.6): a thread pushed in this visit no longer waits for
 * an answer, even before GitLab's list is read again; one it resolved and the list keeps is not
 * counted a second time in "resolved earlier".
 */
export function visitCounts(mr: AuthorMr, listed: AuthorThread[], drafts: Drafts): VisitCounts {
  const stillCounted = mr.threads.filter((t) => pushed(drafts[t.id]) && !answered(t)).length;
  const kept = listed.filter((t) => !mr.threads.some((n) => n.id === t.id));
  const count = Math.max(0, mr.resolved.count - kept.length);
  const excerpt = mr.resolved.firstExcerpt;
  const keptExcerpt = kept.some((t) => t.excerpt === excerpt);
  return {
    toAnswer: Math.max(0, mr.toAnswer - stillCounted),
    resolved: { count, firstExcerpt: count > 0 && !keptExcerpt ? excerpt : null },
  };
}

/** "BK" of "Bartek K.": the first letters of the first two words. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => w !== '')
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

/**
 * The thread with my reply as its last note once Push and reply sent it in this visit (F-26.6,
 * Author.dc.html: "You · just now · Fixed in 9e1d4b7. …"), unless GitLab's list already ends with
 * it. `me` is the signed-in user's display name.
 */
export function withPushedReply(
  thread: AuthorThread,
  draft: AuthorCommitDraft | undefined,
  me: string | undefined,
): AuthorThread {
  if (!draft || !pushed(draft) || draft.reply.trim() === '') return thread;
  const last = thread.notes.at(-1);
  if (last?.mine === true && last.body === draft.reply) return thread;
  const note: AuthorNote = {
    author: me ?? '',
    avatar: initialsOf(me ?? ''),
    body: draft.reply,
    createdAt: new Date(draft.pushedAt ?? Date.now()).toISOString(),
    mine: true,
  };
  return { ...thread, notes: [...thread.notes, note] };
}
