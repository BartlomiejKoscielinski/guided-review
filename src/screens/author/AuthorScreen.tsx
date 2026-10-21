import { useRef, useState } from 'react';
import { Square } from '../../components/Square';
import { headingText, resolvedText } from './authorText';
import { AuthorThreadView } from './AuthorThreadView';
import { ThreadList } from './ThreadList';
import { useRouteAuthorMr } from './useRouteAuthorMr';
import styles from './Author.module.css';

/**
 * S-10 Your MR (F-26.1), left panel: "Feedback on your MR", how many threads wait for an answer,
 * the branch, the thread list (first thread selected), the threads resolved earlier and the
 * safety note; the main column opens the selected thread in the code (F-26.2). Read from the active repository's GitLab project when opened by navigation; a
 * restored start reads nothing (F-30.4) and asks to open the MR again.
 */
export function AuthorScreen() {
  const { restored, noProject, mr } = useRouteAuthorMr();
  const [picked, setPicked] = useState<string | null>(null);
  const threads = mr.data?.threads ?? [];
  const thread = threads.find((t) => t.id === picked) ?? threads[0];
  const selected = thread?.id ?? null;
  const mainRef = useRef<HTMLDivElement>(null);
  const resolved = mr.data ? resolvedText(mr.data.resolved) : null;

  return (
    <div className={styles.screen}>
      <aside aria-label="Threads on your MR" className={styles.panel}>
        <div className={styles.head}>
          <span className={styles.label}>Feedback on your MR</span>
          {mr.data && (
            <>
              <h1 className={styles.heading}>{headingText(mr.data.toAnswer)}</h1>
              <span className={styles.branch}>
                {`${mr.data.sourceBranch} → ${mr.data.targetBranch}`}
              </span>
            </>
          )}
        </div>
        {restored ? (
          <p className={styles.note}>Open the MR again to load it.</p>
        ) : noProject ? (
          <p role="alert" className={styles.error}>
            The active repository has no GitLab project.
          </p>
        ) : mr.isError ? (
          <p role="alert" className={styles.error}>
            {mr.error.message}
          </p>
        ) : mr.data ? (
          <div className={styles.threads}>
            {threads.length > 0 && (
              <ThreadList threads={threads} selected={selected} onSelect={setPicked} />
            )}
            {resolved !== null && (
              <div className={styles.resolved}>
                <Square color="green" size={10} />
                {resolved}
              </div>
            )}
          </div>
        ) : null}
        <div className={styles.safety}>
          <span className={styles.safetyTitle}>
            <Square color="purple" size={9} />
            <span>Fixes stay on your branch</span>
          </span>
          <span>
            Claude may edit only the file a thread points at. You accept every change, commit and
            push yourself.
          </span>
        </div>
      </aside>
      <div ref={mainRef} className={styles.main}>
        {mr.data && thread && (
          <AuthorThreadView
            key={thread.id}
            thread={thread}
            threads={threads}
            target={mr.data.targetBranch}
            scrollRoot={mainRef}
          />
        )}
      </div>
    </div>
  );
}
