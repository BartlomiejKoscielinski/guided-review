import type { AddedReviewer } from './Reviewers';

/**
 * The Reviewer list of S-11 (F-27.3): the suggestions, then whoever was added and isn't suggested
 * (from the search or another target), with the reason they were added with.
 */
export function reviewerRows(suggested: AddedReviewer[], added: AddedReviewer[]): AddedReviewer[] {
  return [...suggested, ...added.filter((a) => !suggested.some((s) => s.username === a.username))];
}

/** The people added, in the order of the Reviewer list (F-27.6). */
export function addedInListOrder(
  suggested: AddedReviewer[],
  added: AddedReviewer[],
): AddedReviewer[] {
  return reviewerRows(suggested, added).filter((row) =>
    added.some((a) => a.username === row.username),
  );
}

/** "Marta K." / "Marta K. and Ola M." / "Marta K., Ola M. and Piotr S.". */
function sentence(names: string[]): string {
  const last = names.at(-1) ?? '';
  return names.length < 2 ? last : `${names.slice(0, -1).join(', ')} and ${last}`;
}

/** The note under Create (CreateMR.dc.html; M7 decision: from three people on "A, B and C"). */
export function notifyNote(names: string[]): string {
  const tail = 'A pipeline starts right away.';
  if (names.length === 0) return `No reviewers yet. ${tail}`;
  return `${sentence(names)} ${names.length === 1 ? 'gets' : 'get'} notified. ${tail}`;
}
