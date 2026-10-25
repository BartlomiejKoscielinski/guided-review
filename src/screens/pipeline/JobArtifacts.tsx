import { useJobArtifacts } from '../../ipc/hooks/useJobArtifacts';
import { usePipelineActions } from '../../ipc/hooks/usePipelineActions';
import styles from './JobArtifacts.module.css';

export interface JobArtifactsProps {
  project: string;
  iid: number;
  /** The successful job whose files are listed. */
  job: number;
  /** Download could not open the browser. */
  onOpenError: (message: string) => void;
}

/**
 * "Artifacts" of a successful job on S-08 (F-20.8, M6 decision 13): one row per file with its
 * name, size and **Download**, which opens the download URL in the browser (its own GitLab
 * sign-in downloads it); "No artifacts." when the job has none. While the list loads only the
 * heading shows; a failed read says so as a status instead of an empty list.
 */
export function JobArtifacts({ project, iid, job, onOpenError }: JobArtifactsProps) {
  const artifacts = useJobArtifacts(project, iid, job);
  const { open } = usePipelineActions(project, iid);

  const download = (url: string) => {
    open.mutate(url, {
      onError: (e) => {
        onOpenError(`Couldn't open GitLab. ${e.message}`);
      },
    });
  };

  return (
    <div className={styles.section}>
      <h3 className={styles.heading}>Artifacts</h3>
      {artifacts.isError && (
        <p role="status" className={styles.note}>
          {`Couldn't load the artifacts. ${artifacts.error.message}`}
        </p>
      )}
      {artifacts.data?.length === 0 && <p className={styles.note}>No artifacts.</p>}
      {artifacts.data !== undefined && artifacts.data.length > 0 && (
        <ul className={styles.list}>
          {artifacts.data.map((a) => (
            <li key={a.url} className={styles.row}>
              <span className={styles.name}>{a.name}</span>
              <span className={styles.size}>{a.size}</span>
              <button
                type="button"
                className={styles.download}
                onClick={() => {
                  download(a.url);
                }}
              >
                Download
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
