import type { FileDiff } from '../../ipc/types/FileDiff';

/** A file's path in the step: its new path, the old one for a deletion. */
export const pathOf = (file: FileDiff): string => file.newPath ?? file.oldPath ?? '';
