import type { FileDiff } from '../../ipc/types/FileDiff';
import type { Thread } from '../../ipc/types/Thread';

/** A file's path in the step: its new path, the old one for a deletion. */
export const pathOf = (file: FileDiff): string => file.newPath ?? file.oldPath ?? '';

/**
 * The thread is on `file`: the file's new path is the thread's new path, or its old path the
 * thread's old path, as the core's `thread_place::same_file` (F-11.3). A thread written before a
 * rename keeps the old name in both paths and matches the renamed file by its old path.
 */
export const threadOnFile =
  (file: FileDiff) =>
  (thread: Thread): boolean => {
    const pos = thread.position;
    if (!pos) return false;
    return (
      (file.newPath !== undefined && file.newPath === pos.newPath) ||
      (file.oldPath !== undefined && file.oldPath === pos.oldPath)
    );
  };
