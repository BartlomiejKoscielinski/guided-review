import type { Thread } from '../../ipc/types/Thread';

/**
 * Who opened the thread: "You" when the first note is the signed-in user's (M5 decision 13, the
 * mock), compared by username since two people can share a name; else the author's name. While
 * the signed-in user is not known (`me` null) the name stands.
 */
export function threadAuthor(thread: Thread, me: string | null): string {
  const author = thread.notes[0]?.author;
  if (!author) return '';
  return me !== null && author.username === me ? 'You' : author.name;
}

/** The notes after the first: "1 reply", "0 replies", "2 replies". */
export function repliesLabel(thread: Thread): string {
  const n = Math.max(0, thread.notes.length - 1);
  return `${String(n)} ${n === 1 ? 'reply' : 'replies'}`;
}

/**
 * The meta line of a Threads tab row before its location (SummaryDesk.dc.html): "author · N
 * replies", with " · resolved" after it for a resolved thread.
 */
export function threadMeta(thread: Thread, me: string | null): string {
  const resolved = thread.resolved ? ' · resolved' : '';
  return `${threadAuthor(thread, me)} · ${repliesLabel(thread)}${resolved}`;
}

/**
 * Where the thread was written: "DeliveryPhotoViewModel.cs:48", the file name and the line on
 * the side it sits on (new, else old), with the full path as the title, as the Drafts rows show
 * it (F-12.3). None for a comment on the MR itself.
 */
export function threadPlace(thread: Thread): { text: string; title: string } | null {
  const pos = thread.position;
  if (!pos) return null;
  const onNew = pos.newLine !== undefined;
  const path = onNew ? pos.newPath : pos.oldPath;
  const name = path.split('/').pop() ?? path;
  const line = onNew ? pos.newLine : pos.oldLine;
  return { text: line === undefined ? name : `${name}:${String(line)}`, title: path };
}
