import { Button } from '../../components/Button';
import { Tag } from '../../components/Tag';
import { useAddRepo, useRemoveRepo, useRepos, useSetDefaultRepo } from '../../ipc/hooks/useRepos';
import styles from './Settings.module.css';

/** Settings › GitLab › Repositories (F-19.6): project, path, worktree folder, default. */
export function RepoList() {
  const repos = useRepos().data ?? [];
  const add = useAddRepo();
  const setDefault = useSetDefaultRepo();
  const remove = useRemoveRepo();
  const error = add.error ?? setDefault.error ?? remove.error;
  return (
    <section aria-labelledby="h-repos" className={styles.sectionRepos}>
      <h2 id="h-repos" className={styles.h2}>
        Repositories
      </h2>
      {repos.length > 0 && (
        <ul className={styles.repos}>
          {repos.map((repo) => (
            <li key={repo.id} className={styles.repo}>
              <span className={styles.repoText}>
                <span className={styles.repoName}>{repo.gitlabProject ?? repo.name}</span>
                <span className={styles.repoMeta}>
                  {repo.path} · review worktrees in {repo.worktreeRoot}
                </span>
              </span>
              <span className={styles.repoActions}>
                {repo.isDefault ? (
                  <Tag color="white">Default</Tag>
                ) : (
                  <Button
                    size={28}
                    aria-label={`Set ${repo.name} as default`}
                    disabled={setDefault.isPending}
                    onClick={() => {
                      setDefault.mutate(repo.id);
                    }}
                  >
                    Set as default
                  </Button>
                )}
                <Button
                  size={28}
                  aria-label={`Remove ${repo.name}`}
                  disabled={remove.isPending}
                  onClick={() => {
                    remove.mutate(repo.id);
                  }}
                >
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Button
        className={styles.addRepo}
        disabled={add.isPending}
        onClick={() => {
          add.mutate(undefined);
        }}
      >
        Add repository
      </Button>
      {error && (
        <span role="alert" className={styles.error}>
          {error.message}
        </span>
      )}
    </section>
  );
}
