import type { BlockColor } from '../../components/colors';
import type { AuthorNote } from '../../ipc/types/AuthorNote';
import type { AuthorThread } from '../../ipc/types/AuthorThread';
import type { PipelineTab } from '../../ipc/types/PipelineTab';
import type { ResolvedSummary } from '../../ipc/types/ResolvedSummary';
import type { ThreadStatus } from '../../ipc/types/ThreadStatus';
import { STATUS_WORD } from '../pipeline/pipelineText';

/** The status tag of a thread (02 › S-10: Question blue, not the mock's orange). */
export const STATUS_TAG: Record<ThreadStatus, { word: string; color: BlockColor }> = {
  changeRequested: { word: 'Change requested', color: 'orange' },
  question: { word: 'Question', color: 'blue' },
  fixProposed: { word: 'Fix proposed', color: 'purple' },
  fixedLocally: { word: 'Fixed locally · not pushed', color: 'yellow' },
  replied: { word: 'Replied', color: 'blue' },
  answered: { word: 'Answered', color: 'blue' },
};

/** The heading: "2 threads to answer", "1 thread to answer" or "All answered". */
export function headingText(toAnswer: number): string {
  if (toAnswer === 0) return 'All answered';
  return `${String(toAnswer)} ${toAnswer === 1 ? 'thread' : 'threads'} to answer`;
}

/** "1 resolved earlier · typo in a log message"; `null` when nothing is resolved. */
export function resolvedText(resolved: ResolvedSummary): string | null {
  if (resolved.count === 0) return null;
  const head = `${String(resolved.count)} resolved earlier`;
  return resolved.firstExcerpt ? `${head} · ${resolved.firstExcerpt}` : head;
}

/** Avatar colours in the order authors first appear (Author.dc.html: MK green, PS orange). */
const AVATAR: readonly BlockColor[] = ['green', 'orange', 'blue', 'purple'];

/** The avatar colour of each thread: one per author, in list order. */
export function avatarColors(threads: AuthorThread[]): BlockColor[] {
  const authors: string[] = [];
  return threads.map((t) => {
    if (!authors.includes(t.author)) authors.push(t.author);
    return AVATAR[authors.indexOf(t.author) % AVATAR.length] ?? 'green';
  });
}

/**
 * The avatar colour of a note in the thread card (F-26.2): its author's colour in the list, a
 * reviewer who opened no thread the next one, my own note yellow (Author.dc.html: BK).
 */
export function noteAvatarColor(threads: AuthorThread[], note: AuthorNote): BlockColor {
  if (note.mine) return 'yellow';
  const authors = [...new Set(threads.map((t) => t.author))];
  const at = authors.indexOf(note.author);
  return AVATAR[(at < 0 ? authors.length : at) % AVATAR.length] ?? 'green';
}

/** The file bar's path split into the folder ("src/App/Workers/") and the file name. */
export function splitPath(path: string): { dir: string; name: string } {
  const cut = path.lastIndexOf('/') + 1;
  return { dir: path.slice(0, cut), name: path.slice(cut) };
}

/**
 * The reply queued after Commit (F-26.5): "Fixed in <sha>. <one sentence>.", the sentence being
 * the commit message's first line as typed with one full stop at the end, never two. No Claude.
 */
export function fixedReply(shortSha: string, message: string): string {
  const sentence = (message.split('\n')[0] ?? '').trim();
  if (sentence === '') return `Fixed in ${shortSha}.`;
  return `Fixed in ${shortSha}. ${/[.!?…]$/.test(sentence) ? sentence : `${sentence}.`}`;
}

/** "Marta" of "Marta K.": the caption names the thread by its author's first name. */
export function firstName(author: string): string {
  return author.trim().split(/\s+/)[0] ?? author;
}

/**
 * What the panel says after **Push and reply** (F-26.6, Author.dc.html `doneText`): "Replied to
 * Marta and resolved the thread." or, with Resolve off, "Replied to Marta. The thread stays open."
 */
export function pushedText(author: string, resolved: boolean): string {
  const name = firstName(author);
  return resolved
    ? `Replied to ${name} and resolved the thread.`
    : `Replied to ${name}. The thread stays open.`;
}

/** The new pipeline's link (M7 decision 13): "Pipeline #18360 running" or "Pipeline starting…". */
export function pushedPipelineText(tab: PipelineTab | null): string {
  if (!tab) return 'Pipeline starting…';
  return `Pipeline #${String(tab.number)} ${STATUS_WORD[tab.status].toLowerCase()}`;
}

/**
 * A question after my reply (F-26.7, Author.dc.html `qSent`): "Answered. The thread stays open
 * until Piotr resolves it." The reviewer by first name, no pronoun guessed from it.
 */
export function answeredText(author: string): string {
  return `Answered. The thread stays open until ${firstName(author)} resolves it.`;
}

/** A question is answered once its last note is mine (GitLab lists my reply) or it reads so. */
export function isAnswered(thread: AuthorThread): boolean {
  return thread.status === 'answered' || thread.notes.at(-1)?.mine === true;
}

/** F-26.8: the notice of read-only author mode, naming the MR's source branch. */
export function readOnlyText(branch: string): string {
  return `Check out ${branch} to fix here. The app never switches your branch.`;
}

/**
 * M7 decision 10: the warning above the fix actions when other files of the checkout have
 * uncommitted changes; the commit takes only the thread's file, so they stay out of it.
 */
export const OTHER_CHANGES_TEXT =
  "You have other uncommitted changes. They won't be part of this commit.";
