import { useNavigate, useSearchParams } from 'react-router';
import { pathFor } from '../../app/routes';
import { cx } from '../../components/cx';
import { CheckIcon } from '../../components/icons';
import { useDrafts } from '../../ipc/hooks/useDrafts';
import { useSessionState } from '../../ipc/hooks/useSessionState';
import type { PlanView } from '../../ipc/types/PlanView';
import { plural } from '../plan/planText';
import { orderCaption, rowEnd, stepDrafts, stepMeta } from './railText';
import styles from './Rail.module.css';

export interface RailProps {
  sessionId: string;
  /** The plan the screen shows; the rail never asks for one (F-30.4). */
  view: PlanView | undefined;
  /** The step on screen: yellow. */
  current: string | undefined;
  /** The open notes of the step on screen; `undefined` until they are there. */
  openNotes: number | undefined;
}

/**
 * The S-04 rail (F-08.3, Main.dc.html's "Review plan"): "Change overview" first (S-02's intent,
 * risks and plan; a green check once S-02 showed the plan), then the steps in the reader's order
 * (a green check when reviewed, the current one yellow, the others numbered) with
 * `layer · N files · +add −del` and the step's drafts, the Skim groups and "Change coverage".
 */
export function Rail({ sessionId, view, current, openNotes }: RailProps) {
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const opened = useSessionState(sessionId).data?.planOpened === true;
  const drafts = useDrafts(sessionId).data ?? [];

  const steps = view
    ? view.order.order.flatMap((id) => {
        const i = view.plan.steps.findIndex((s) => s.id === id);
        const step = view.plan.steps[i];
        const stats = view.stepStats[i];
        return step && stats ? [{ step, stats }] : [];
      })
    : [];
  const skimFiles = view ? view.skimStats.reduce((n, s) => n + s.files, 0) : 0;
  const coverage = view?.plan.coverage;
  const covered =
    coverage && coverage.filesTotal > 0
      ? Math.min(100, (coverage.files / coverage.filesTotal) * 100)
      : 100;

  return (
    <nav aria-label="Review plan" className={styles.rail}>
      <div className={styles.head}>
        <span>Review plan</span>
        {view && <span>{orderCaption(view.order)}</span>}
      </div>

      <button
        type="button"
        className={cx(styles.row, styles.overview)}
        onClick={() => {
          void navigate(pathFor({ screen: 'S-02', sessionId }));
        }}
      >
        <span className={cx(styles.mark, opened && styles.done)}>{opened && <CheckIcon />}</span>
        <span className={styles.text}>
          <span className={styles.title}>Change overview</span>
          <span className={styles.sub}>intent, risks, plan</span>
        </span>
        <span />
      </button>

      {steps.map(({ step, stats }, i) => {
        const on = step.id === current;
        const reviewed = view?.reviewed.includes(step.id) === true;
        const end = rowEnd(on, on ? openNotes : undefined, stepDrafts(drafts, step.id));
        return (
          <button
            key={step.id}
            type="button"
            className={cx(styles.row, on && styles.current, reviewed && !on && styles.reviewed)}
            aria-current={on ? 'step' : undefined}
            onClick={() => {
              setParams({ step: step.id });
            }}
          >
            <span className={cx(styles.mark, reviewed && styles.done)}>
              {reviewed ? <CheckIcon /> : i + 1}
            </span>
            <span className={styles.text}>
              <span className={styles.title}>{step.title}</span>
              <span className={styles.meta}>{stepMeta(step.layer, stats)}</span>
            </span>
            {end?.kind === 'notes' && <span className={styles.notes}>{end.label}</span>}
            {end?.kind === 'drafts' && (
              <span className={styles.drafts} title={end.title}>
                {end.count}
              </span>
            )}
            {end === null && <span />}
          </button>
        );
      })}

      {view && view.plan.skim.length > 0 && (
        <div className={styles.skim}>
          <div className={styles.sectionHead}>
            <span>Skim</span>
            <span>{plural(skimFiles, 'file')}</span>
          </div>
          <div className={styles.skimList}>
            {view.plan.skim.map((group, i) => (
              <span key={group.hunkIds[0] ?? String(i)}>{group.reason}</span>
            ))}
          </div>
        </div>
      )}

      {coverage && (
        <div className={styles.coverage}>
          <div className={styles.coverageHead}>
            <span>Change coverage</span>
            <span className={styles.coverageValue}>
              {coverage.files}/{coverage.filesTotal} files
            </span>
          </div>
          <span className={styles.bar} aria-hidden="true">
            <span className={styles.barFill} style={{ width: `${String(covered)}%` }} />
          </span>
          <span className={styles.rule}>
            Every hunk belongs to a step. The order can change, the scope can’t.
          </span>
        </div>
      )}
    </nav>
  );
}
