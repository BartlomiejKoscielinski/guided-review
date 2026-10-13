import { useState } from 'react';
import { useNavigate } from 'react-router';
import { pathFor } from '../../app/routes';
import { Button } from '../../components/Button';
import { LocalChangesIcon } from '../../components/icons';
import { RadioCard } from '../../components/RadioCard';
import { useActiveRepo, usePickRepo } from '../../ipc/hooks/useChanges';
import { useOpenLocal, useStatusSummary } from '../../ipc/hooks/useSources';
import { Column } from './Column';
import columnStyles from './Column.module.css';
import { scopeOptions, type ScopeId } from './localScopes';
import styles from './MyChanges.module.css';

const SKELETON_ROWS = [0, 1, 2];

function PickRepository() {
  const pick = usePickRepo();
  return (
    <>
      <div className={styles.actions}>
        <Button
          variant="primary"
          size={38}
          disabled={pick.isPending}
          onClick={() => {
            pick.mutate(undefined);
          }}
        >
          Pick a repository
        </Button>
      </div>
      {pick.error && (
        <p role="alert" className={columnStyles.error}>
          {pick.error.message}
        </p>
      )}
    </>
  );
}

/**
 * S-01 My changes column (F-03.3, F-03.4): the current branch, three scopes with counts,
 * Review before push (self-review) and Browse and commit (S-06 local mode). Without a repository,
 * or when the folder is no git repository, "Pick a repository" (folder dialog).
 */
export function MyChanges() {
  const navigate = useNavigate();
  const repo = useActiveRepo();
  const summary = useStatusSummary(Boolean(repo.data));
  const open = useOpenLocal();
  const [scopeId, setScopeId] = useState<ScopeId>('uncommitted');
  const options = summary.data ? scopeOptions(summary.data) : [];
  const chosen = options.find((o) => o.id === scopeId) ?? options[0];

  const onReview = () => {
    if (!chosen) return;
    open.mutate(chosen.scope, {
      onSuccess: (opened) => {
        void navigate(pathFor(opened.route));
      },
    });
  };

  const scopes = () => {
    if (!summary.data) {
      return (
        <div className={styles.cards} aria-busy="true" aria-label="Loading changes">
          {SKELETON_ROWS.map((i) => (
            <span key={i} className={styles.skeleton} />
          ))}
        </div>
      );
    }
    return (
      <fieldset className={styles.cards}>
        <legend className={styles.legend}>Scope</legend>
        {options.map((o) => (
          <RadioCard
            key={o.id}
            name="local-scope"
            checked={o.id === chosen?.id}
            onSelect={() => {
              setScopeId(o.id);
            }}
            label={o.label}
            meta={o.meta}
          />
        ))}
      </fieldset>
    );
  };

  return (
    <Column
      id="h-local"
      title="My changes"
      icon={<LocalChangesIcon strokeWidth={2.2} />}
      tone="green"
      aside={summary.data?.branch}
    >
      {repo.data === null || summary.error ? (
        <>
          {summary.error && <p className={columnStyles.message}>{summary.error.message}</p>}
          <PickRepository />
        </>
      ) : (
        <>
          {scopes()}
          <p className={styles.note}>
            Self-review never publishes anything. You end with a list of fixes before pushing and a
            draft MR description.
          </p>
          {open.error && (
            <p role="alert" className={columnStyles.error}>
              {open.error.message}
            </p>
          )}
          <div className={styles.actions}>
            <Button
              variant="primary"
              size={38}
              disabled={!chosen || open.isPending}
              onClick={onReview}
            >
              Review before push
            </Button>
            <Button
              variant="neutral"
              size={38}
              disabled={!repo.data}
              onClick={() => {
                void navigate(pathFor({ screen: 'S-06' }));
              }}
            >
              Browse and commit
            </Button>
          </div>
        </>
      )}
    </Column>
  );
}
