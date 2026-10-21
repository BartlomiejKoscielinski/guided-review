import type { BlockColor } from '../../components/colors';
import type { AuthorThread } from '../../ipc/types/AuthorThread';
import type { ResolvedSummary } from '../../ipc/types/ResolvedSummary';
import type { ThreadStatus } from '../../ipc/types/ThreadStatus';

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
