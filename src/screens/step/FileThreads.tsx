import { useRef } from 'react';
import type { Thread } from '../../ipc/types/Thread';
import { ThreadCard } from './ThreadCard';
import { useThreadReveal } from './threadReveal';
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
 * The one S-05's Show in code opened the step for comes into view once (M5 decision 13).
 */
export function FileThreads({ threads, path, scope }: FileThreadsProps) {
  const reveal = useThreadReveal();
  const revealed = useRef<number | null>(null);
  const show = (el: HTMLDivElement | null) => {
    if (el === null || reveal === null || revealed.current === reveal.nonce) return;
    revealed.current = reveal.nonce;
    // jsdom (Vitest) lays nothing out and has no scrollIntoView.
    if ('scrollIntoView' in el) el.scrollIntoView({ block: 'nearest' });
  };
  return threads.map((thread) =>
    thread.id === reveal?.thread ? (
      <div key={thread.id} ref={show}>
        <ThreadCard thread={thread} file={path} scope={scope} />
      </div>
    ) : (
      <ThreadCard key={thread.id} thread={thread} file={path} scope={scope} />
    ),
  );
}
