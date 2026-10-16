import type { Thread } from '../../ipc/types/Thread';
import { ThreadCard } from './ThreadCard';
import type { ThreadScope } from './useThreadCard';

export interface FileThreadsProps {
  /** The step's threads on this file's header (`StepView.fileThreads` of the file). */
  threads: readonly Thread[];
  path: string;
  scope?: ThreadScope;
}

/**
 * The threads on a file's header, between the header and the diff, the same in Focus and Detailed
 * mode (F-11.3, M5 decision 4): a thread written on another version with no matching line, or one
 * on a line no step shows (an expanded-context comment in GitLab). Always open; no gutter icon.
 */
export function FileThreads({ threads, path, scope }: FileThreadsProps) {
  return threads.map((thread) => (
    <ThreadCard key={thread.id} thread={thread} file={path} scope={scope} />
  ));
}
