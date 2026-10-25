import { useState } from 'react';
import { Link } from 'react-router';
import { pathFor } from '../../app/routes';
import { useIpc } from '../../ipc/IpcContext';
import type { CreatedMr } from '../../ipc/types/CreatedMr';
import styles from './MrCreated.module.css';

interface Props {
  mr: CreatedMr;
  /** The people added, in the order of the Reviewer list. */
  reviewers: string[];
}

/**
 * S-11 after Create (F-27.6, CreateMR.dc.html {"created":true}): the green block with "!<iid>"
 * and the title GitLab stored, the tiles (the pipeline, opening S-08; Reviewers notified; You’ll
 * hear about) and **Go to your MR** (S-10), **Copy link**, **Open in GitLab**.
 */
export function MrCreated({ mr, reviewers }: Props) {
  const ipc = useIpc();
  const [copied, setCopied] = useState<boolean | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const copy = () => {
    navigator.clipboard.writeText(mr.webUrl).then(
      () => {
        setCopied(true);
      },
      () => {
        setCopied(false);
      },
    );
  };
  const open = () => {
    setOpenError(null);
    ipc.osOpenGitlabUrl(mr.webUrl).catch((error: unknown) => {
      setOpenError(error instanceof Error ? error.message : 'Couldn’t open the link.');
    });
  };
  const pipeline = mr.pipeline;

  return (
    <div className={styles.view}>
      <section aria-label="Merge request created" className={styles.block}>
        <span className={styles.label}>Merge request created</span>
        <span className={styles.number}>!{mr.iid}</span>
        <span className={styles.title}>{mr.title}</span>
      </section>
      <div className={styles.tiles}>
        <Link
          to={pathFor({ screen: 'S-08', iid: mr.iid })}
          className={styles.tile}
          data-state={pipeline?.status ?? 'waiting'}
        >
          <span className={styles.pipelineLabel}>
            <span className={styles.square} aria-hidden="true" />
            Pipeline
          </span>
          <span className={styles.value}>
            {pipeline === null
              ? 'Pipeline starting…'
              : `#${String(pipeline.id)} ${pipeline.status}`}
          </span>
        </Link>
        <div className={styles.tile}>
          <span className={styles.tileLabel}>Reviewers notified</span>
          <span className={styles.value}>
            {reviewers.length === 0 ? 'nobody yet' : reviewers.join(', ')}
          </span>
        </div>
        <div className={styles.tile}>
          <span className={styles.tileLabel}>You’ll hear about</span>
          <span className={styles.value}>comments and pipeline, in the tray</span>
        </div>
      </div>
      <div className={styles.actions}>
        <Link to={pathFor({ screen: 'S-10', iid: mr.iid })} className={styles.go}>
          Go to your MR
        </Link>
        <button type="button" className={styles.copy} onClick={copy}>
          Copy link
        </button>
        <button type="button" className={styles.open} onClick={open}>
          Open in GitLab
        </button>
        <span role="status" className={styles.status}>
          {copied === null ? null : copied ? 'Copied.' : 'Couldn’t copy.'}
        </span>
      </div>
      {openError !== null && (
        <p className={styles.alert} role="alert">
          {openError}
        </p>
      )}
    </div>
  );
}
