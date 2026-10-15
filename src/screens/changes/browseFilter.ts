/**
 * Router state of the MR browse (S-06): the files of one skim row (F-06.6 Show). Without it the
 * browse lists the whole change (Browse files instead, the dock tile).
 */
export interface BrowseFilter {
  files: readonly string[];
}

/** The state to pass to `navigate` for a browse of these files. */
export function browseFilter(files: readonly string[]): BrowseFilter {
  return { files };
}

/** The files a navigation asked the browse to show, or `null` for the whole change. */
export function browseFiles(state: unknown): readonly string[] | null {
  if (typeof state !== 'object' || state === null || !('files' in state)) return null;
  const { files } = state;
  if (!Array.isArray(files) || !files.every((f) => typeof f === 'string')) return null;
  return files;
}
