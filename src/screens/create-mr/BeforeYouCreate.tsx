import { useId } from 'react';
import { Button } from '../../components/Button';
import type { IpcError } from '../../ipc/errors';
import { usePushForChecks } from '../../ipc/hooks/useMergeCheck';
import type { MergeCheck } from '../../ipc/types/MergeCheck';
import { type CheckRow, checkRows } from './mergeChecks';
import styles from './BeforeYouCreate.module.css';

interface Props {
  check: MergeCheck | undefined;
  /** The first answer has not arrived yet. */
  loading: boolean;
  error: IpcError | null;
}

/** The square of a check: a tick when it passes, an exclamation mark when it is orange. */
function Mark({ ok }: { ok: boolean }) {
  return (
    <span className={styles.square}>
      <svg
        width="11"
        height="11"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="square"
        aria-hidden="true"
      >
        <path d={ok ? 'M3 8.5l3.2 3L13 4.5' : 'M8 2.5v7M8 13v.5'} />
      </svg>
    </span>
  );
}

/** **Push now** in the branch check; the checks are read again after the push. */
function PushNow() {
  const push = usePushForChecks();
  return (
    <>
      <Button
        size={30}
        disabled={push.isPending}
        onClick={() => {
          push.mutate(undefined);
        }}
      >
        {push.isPending ? 'Pushing…' : 'Push now'}
      </Button>
      {push.isError && (
        <p className={styles.alert} role="alert">
          {push.error.message}
        </p>
      )}
    </>
  );
}

function Row({ row }: { row: CheckRow }) {
  const canPush = row.id === 'branch' && !row.ok;
  return (
    <li className={styles.check} data-state={row.ok ? 'ok' : 'warn'}>
      <Mark ok={row.ok} />
      <span className={styles.text}>
        <span className={styles.label}>{row.label}</span>
        <span className={styles.note}>{row.note}</span>
      </span>
      {canPush && <PushNow />}
    </li>
  );
}

/**
 * "Before you create" in the S-11 aside (F-27.5): Branch pushed, No conflicts with `<target>`
 * (local `git merge-tree`) and Self-review done, orange with details when they fail.
 */
export function BeforeYouCreate({ check, loading, error }: Props) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} aria-busy={loading} className={styles.section}>
      <h2 id={headingId} className={styles.heading}>
        Before you create
      </h2>
      {check !== undefined ? (
        <ul className={styles.list}>
          {checkRows(check).map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </ul>
      ) : error !== null ? (
        <p className={styles.alert} role="alert">
          {error.message}
        </p>
      ) : (
        <div className={styles.loading} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
    </section>
  );
}
