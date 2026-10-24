import { useRef, useState } from 'react';
import { Square } from '../../components/Square';
import { useAuthorRefreshOnFocus } from '../../ipc/hooks/useAuthorMr';
import { useGitlabStatus } from '../../ipc/hooks/useGitlab';
import type { AuthorMr } from '../../ipc/types/AuthorMr';
import type { AuthorThread } from '../../ipc/types/AuthorThread';
import { useAuthorCommitStore } from '../../state/authorCommit';
import { headingText, resolvedText } from './authorText';
import { AuthorThreadView } from './AuthorThreadView';
import { keepPushed, tagOf, visitCounts, withPushedReply } from './pushedThreads';
import { ThreadList } from './ThreadList';
import { useRouteAuthorMr } from './useRouteAuthorMr';
import styles from './Author.module.css';

/**
 * S-10 Your MR (F-26.1), left panel: "Feedback on your MR", how many threads wait for an answer,
 * the branch, the thread list (first thread selected), the threads resolved earlier and the
 * safety note; the main column opens the selected thread in the code (F-26.2). A thread pushed in
 * this visit reads Resolved or Replied and stays listed (F-26.6). Read from the active repository's GitLab project when opened by navigation; a
 * restored start reads nothing (F-30.4) and asks to open the MR again.
 */
export function AuthorScreen() {
  const { iid, project, restored, noProject, mr } = useRouteAuthorMr();
  // F-26.8: the checkout may change outside the app; coming back reads it again.
  useAuthorRefreshOnFocus(project, iid);
  const drafts = useAuthorCommitStore((s) => s.drafts);
  const [picked, setPicked] = useState<string | null>(null);
  // A thread resolved by a push in this visit stays listed when GitLab's list is read again.
  const [listed, setListed] = useState<{ from: AuthorMr | undefined; threads: AuthorThread[] }>({
    from: undefined,
    threads: [],
  });
  if (listed.from !== mr.data) {
    setListed({
      from: mr.data,
      threads: mr.data ? keepPushed(listed.threads, mr.data.threads, drafts) : [],
    });
  }
  // My name for the reply note after a push; a restored start reads nothing (F-30.4).
  const me = useGitlabStatus(!restored).data?.user?.name;
  const threads = (listed.from === mr.data ? listed.threads : (mr.data?.threads ?? [])).map((t) =>
    withPushedReply(t, drafts[t.id], me),
  );
  const thread = threads.find((t) => t.id === picked) ?? threads[0];
  const selected = thread?.id ?? null;
  const mainRef = useRef<HTMLDivElement>(null);
  const counts = mr.data ? visitCounts(mr.data, threads, drafts) : null;
  const resolved = counts ? resolvedText(counts.resolved) : null;

  return (
    <div className={styles.screen}>
      <aside aria-label="Threads on your MR" className={styles.panel}>
        <div className={styles.head}>
          <span className={styles.label}>Feedback on your MR</span>
          {mr.data && (
            <>
              <h1 className={styles.heading}>{headingText(counts?.toAnswer ?? 0)}</h1>
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
        ) : mr.isError && !mr.data ? (
          <p role="alert" className={styles.error}>
            {mr.error.message}
          </p>
        ) : mr.data ? (
          <div className={styles.threads}>
            {threads.length > 0 && (
              <ThreadList
                threads={threads}
                tagOf={(t) => tagOf(t, drafts[t.id])}
                selected={selected}
                onSelect={setPicked}
              />
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
        {mr.data && thread && project && (
          <AuthorThreadView
            key={thread.id}
            thread={thread}
            threads={threads}
            target={mr.data.targetBranch}
            source={mr.data.sourceBranch}
            waiting={mr.data.waiting.find((w) => w.reply.discussion === thread.id)}
            project={project}
            iid={iid}
            scrollRoot={mainRef}
            readOnly={!mr.data.onSourceBranch}
          />
        )}
      </div>
    </div>
  );
}
