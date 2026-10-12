import { useState } from 'react';
import { Button } from '../../components/Button';
import { Square } from '../../components/Square';
import { useGitlabStatus, useRemoveGitlabAccount } from '../../ipc/hooks/useGitlab';
import { GitlabTokenForm } from './GitlabTokenForm';
import { gitlabStatusText, tokenMeta } from './gitlabText';
import { RepoList } from './RepoList';
import styles from './Settings.module.css';

/** Settings › GitLab (F-19.2, F-19.5, F-19.6, Settings.dc.html). */
export function GitlabSection() {
  const status = useGitlabStatus();
  const remove = useRemoveGitlabAccount();
  const [replacing, setReplacing] = useState(false);
  const data = status.data;
  if (!data) return null;
  const stored = data.tokenMasked != null;
  return (
    <div className={styles.content}>
      <section className={styles.titleBlock}>
        <h1 className={styles.h1}>GitLab</h1>
        <span className={styles.status} role="status">
          <span className={styles.statusText}>
            <Square color={data.state === 'connected' ? 'green' : 'orange'} size={9} />
            {gitlabStatusText(data)}
          </span>
        </span>
      </section>
      {stored && !replacing ? (
        <div className={styles.grid}>
          <span className={styles.label}>Server</span>
          <span className={styles.value}>{data.server}</span>
          <span className={styles.label}>Access token</span>
          <span className={styles.inline}>
            <span className={styles.value}>{data.tokenMasked}</span>
            <span className={styles.hint}>{tokenMeta(data)}</span>
            <Button
              size={28}
              onClick={() => {
                setReplacing(true);
              }}
            >
              Replace token
            </Button>
            <Button
              size={28}
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate(undefined);
              }}
            >
              Remove
            </Button>
          </span>
          {remove.error && (
            <>
              <span />
              <span role="alert" className={styles.error}>
                {remove.error.message}
              </span>
            </>
          )}
        </div>
      ) : (
        <GitlabTokenForm
          server={data.server}
          onCancel={
            stored
              ? () => {
                  setReplacing(false);
                }
              : undefined
          }
          onSaved={() => {
            setReplacing(false);
          }}
        />
      )}
      <RepoList />
    </div>
  );
}
