import { useIsMutating } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { GITLAB_SETTINGS_ROUTE, pathFor } from '../../app/routes';
import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { MergeRequestIcon } from '../../components/icons';
import { useGitlabStatus, useMrList } from '../../ipc/hooks/useGitlab';
import { useSettings } from '../../ipc/hooks/useSettings';
import { OPEN_REVIEW_KEY, useOpenSource } from '../../ipc/hooks/useSources';
import type { MrRow } from '../../ipc/types/MrRow';
import type { MrTab } from '../../ipc/types/MrTab';
import { useStartStore } from '../../state/start';
import { Column } from './Column';
import columnStyles from './Column.module.css';
import { MrRowItem } from './MrRowItem';
import { age } from './mrRow';
import { useNow } from './useNow';
import styles from './MergeRequests.module.css';

const TABS: readonly { id: MrTab; label: string; empty: string }[] = [
  { id: 'waiting', label: 'Waiting for me', empty: 'Nothing waiting for you.' },
  { id: 'mine', label: 'Mine', empty: 'You have no open merge requests.' },
  { id: 'all', label: 'All open', empty: 'No open merge requests.' },
];

const SKELETON_ROWS = [0, 1, 2];

/** F-28.2 default, until the settings load. */
const DEFAULT_POLL_MINUTES = 3;
/** How often the age of the data is recomputed. */
const AGE_TICK_MS = 30_000;

/** Settings › GitLab fixes these: no token, or one GitLab doesn't accept. */
const TOKEN_CODES = new Set(['GITLAB_UNAUTHORIZED', 'GITLAB_FORBIDDEN']);

function AddToken() {
  const navigate = useNavigate();
  return (
    <div className={styles.addToken}>
      <Button
        variant="send"
        size={36}
        onClick={() => {
          void navigate(pathFor(GITLAB_SETTINGS_ROUTE));
        }}
      >
        Add your GitLab token
      </Button>
    </div>
  );
}

/**
 * S-01 Merge requests column (F-02.1–F-02.3): Waiting for me / Mine / All open with counts,
 * rows as in Start.dc.html, 3 skeleton rows while loading, and "Add your GitLab token".
 * Lists refresh on focus and every `poll.minutes`; older data shows "Updated 7 min ago" (F-02.4).
 */
export function MergeRequests() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<MrTab>('waiting');
  const status = useGitlabStatus();
  const state = status.data?.state;
  const tokenProblem =
    state === 'noToken' ||
    (state === 'failing' && TOKEN_CODES.has(status.data?.problem?.code ?? ''));
  const settings = useSettings();
  const pollMs = (settings.data?.poll.minutes ?? DEFAULT_POLL_MINUTES) * 60_000;
  const list = useMrList(tab, state === 'connected', pollMs);
  const clock = useNow(AGE_TICK_MS);
  const open = useOpenSource();
  // A review being prepared from anywhere on S-01 keeps the rows and their pipeline links inert.
  const openingHere = useStartStore((s) => s.opening > 0);
  const openingElsewhere = useIsMutating({ mutationKey: OPEN_REVIEW_KEY }) > 0;
  const opening = openingHere || openingElsewhere;
  const listTokenProblem = list.error !== null && TOKEN_CODES.has(list.error.code);
  const counts = list.data?.counts;
  // Ages as of the fetch: the list is as old as its data (F-02.4).
  const now = list.dataUpdatedAt;
  const fresh = list.data !== undefined && !list.isPlaceholderData;
  const stale = fresh && clock - now > pollMs;

  const onOpen = (row: MrRow) => {
    // Own MR: author mode (S-10, M7); a teammate's: preparation, then the plan (S-02).
    if (row.mine) {
      void navigate(pathFor({ screen: 'S-10', iid: row.iid }));
      return;
    }
    open.mutate(`!${String(row.iid)}`, {
      onSuccess: (opened) => {
        void navigate(pathFor(opened.route));
      },
    });
  };

  const body = () => {
    if (tokenProblem || listTokenProblem) return <AddToken />;
    if (state === 'failing' && status.data?.problem) {
      return <p className={columnStyles.message}>{status.data.problem.message}</p>;
    }
    // A failed refresh keeps the rows; their age says how old they are.
    if (list.error && !fresh) return <p className={columnStyles.message}>{list.error.message}</p>;
    if (!list.data || list.isPlaceholderData) {
      return (
        <div className={styles.rows} aria-busy="true" aria-label="Loading merge requests">
          {SKELETON_ROWS.map((i) => (
            <span key={i} className={styles.skeleton} />
          ))}
        </div>
      );
    }
    if (list.data.rows.length === 0) {
      return <p className={columnStyles.message}>{TABS.find((t) => t.id === tab)?.empty}</p>;
    }
    return (
      <div className={styles.rows}>
        {list.data.rows.map((row) => (
          <MrRowItem key={row.iid} row={row} now={now} disabled={opening} onOpen={onOpen} />
        ))}
      </div>
    );
  };

  const showTabs = !tokenProblem && !listTokenProblem;
  return (
    <Column
      id="h-mr"
      title="Merge requests"
      icon={<MergeRequestIcon strokeWidth={2.2} />}
      tone="blue"
      aside={
        stale ? (
          <span className={styles.age}>Updated {age(new Date(now).toISOString(), clock)} ago</span>
        ) : undefined
      }
    >
      {showTabs && (
        <div role="tablist" aria-label="Merge request filter" className={styles.tabs}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === tab}
              className={cx(styles.tab, t.id === tab && styles.tabOn)}
              onClick={() => {
                setTab(t.id);
              }}
            >
              {t.label} <span className={styles.count}>{counts ? counts[t.id] : ''}</span>
            </button>
          ))}
        </div>
      )}
      {open.error && (
        <p role="alert" className={columnStyles.error}>
          {open.error.message}
        </p>
      )}
      {body()}
    </Column>
  );
}
