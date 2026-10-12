import type { ReactNode } from 'react';
import { Square } from '../../components/Square';
import { useClaudeStatus, useCommitMessage } from '../../ipc/hooks/useClaude';
import { statusText } from '../settings/claudeStatusText';
import styles from './Changes.module.css';

export interface Suggest {
  pending: boolean;
  run: () => void;
  notice: ReactNode;
}

/**
 * Suggest (F-16.4): Claude writes a commit message from the staged diff. A failure never
 * touches the message being written (NFR-03); a usage limit says so with the reset time
 * (F-18.7) and the user can retry.
 */
export function useSuggest(onMessage: (message: string) => void): Suggest {
  const task = useCommitMessage(onMessage);
  const status = useClaudeStatus();
  const error = task.error;
  let notice: ReactNode = null;
  if (error) {
    const text =
      error.code === 'CLAUDE_LIMITED' && status.data?.state === 'limited'
        ? statusText(status.data)
        : error.message;
    notice = (
      <p role="alert" className={styles.notice}>
        <Square color="orange" size={9} />
        {text}
      </p>
    );
  }
  return {
    pending: task.isPending,
    run: () => {
      task.mutate(crypto.randomUUID());
    },
    notice,
  };
}
