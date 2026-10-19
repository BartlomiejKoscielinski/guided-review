import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router';
import type { StartState } from '../../app/router';
import {
  hasActiveJob,
  usePipelineHead,
  usePipelineJobs,
  usePipelineList,
  useRunPipeline,
} from '../../ipc/hooks/usePipeline';
import { useRepos } from '../../ipc/hooks/useRepos';
import { PipelineActions } from './PipelineActions';
import { PipelineHeader } from './PipelineHeader';
import { PipelineJobs } from './PipelineJobs';
import { PipelineTabs } from './PipelineTabs';
import { RunPipelineConfirm } from './RunPipelineConfirm';
import { refusalOf } from './pipelineText';
import styles from './Pipeline.module.css';

const HEAD_ID = 'pipeline-head';

/**
 * S-08 Pipeline (F-20.1): the MR's pipelines as tabs, newest first, and the selected pipeline's
 * status block and meta line, read from the active repository's GitLab project; its stage
 * columns (F-20.2), with the head and the jobs read again every 5 s while a job runs or waits;
 * Run new pipeline asks first and then selects the new pipeline (F-20.3, decision 8); Retry failed
 * jobs, Cancel pipeline and Open in GitLab (F-20.4). After a write GitLab refuses with 403 every
 * write of the screen is disabled with GitLab's reason until it reopens (decision 9). A restored
 * start reads nothing (F-30.4); it asks to open the pipeline again.
 */
export function PipelineScreen() {
  const iid = Number(useParams().iid);
  const restored = (useLocation().state as StartState | null)?.restored === true;
  const repos = useRepos();
  const project = repos.data?.find((r) => r.isActive)?.gitlabProject;
  const list = usePipelineList(project, iid, !restored);
  const [picked, setPicked] = useState<number | null>(null);
  const tabs = list.data ?? [];
  const selected = tabs.find((t) => t.id === picked)?.id ?? tabs[0]?.id ?? null;
  const shown = restored ? null : selected;
  const jobs = usePipelineJobs(project, iid, shown);
  const head = usePipelineHead(project, iid, shown, hasActiveJob(jobs.data));
  const noProject = !restored && repos.isSuccess && !project;
  const runner = useRunPipeline(project ?? '', iid);
  const [confirming, setConfirming] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const runButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const running = runner.run.isPending;
  // Back to Run new pipeline once GitLab answered (the button is disabled while it starts).
  useEffect(() => {
    if (running || !refocus.current) return;
    refocus.current = false;
    runButton.current?.focus();
  }, [running]);

  const failed = (e: Error) => {
    setRunError(`Couldn't run a pipeline. ${e.message}`);
  };
  const askRun = () => {
    if (confirming || running || refused !== null) return;
    setRunError(null);
    setConfirming(true);
    runner.head.reset();
    runner.head.mutate(undefined, {
      onError: (e) => {
        setConfirming(false);
        failed(e);
        runButton.current?.focus();
      },
    });
  };
  const cancelRun = () => {
    setConfirming(false);
    runButton.current?.focus();
  };
  const confirmRun = () => {
    setConfirming(false);
    refocus.current = true;
    runner.run.mutate(undefined, {
      onSuccess: (tab) => {
        setPicked(tab.id);
      },
      onError: (e) => {
        failed(e);
        const refusal = refusalOf(e);
        if (refusal !== null) setRefused(refusal);
      },
    });
  };

  return (
    <div className={styles.screen}>
      <PipelineHeader
        head={head.data}
        id={HEAD_ID}
        onRun={askRun}
        running={running}
        runDisabled={restored || !project}
        runRef={runButton}
        refused={refused}
      >
        <PipelineActions
          project={project ?? ''}
          iid={iid}
          pipeline={shown}
          head={head.data}
          jobs={jobs.data}
          refused={refused}
          onRefused={setRefused}
          onFailure={setRunError}
          showOpen={!(list.isSuccess && tabs.length === 0)}
        />
      </PipelineHeader>
      {runError !== null && (
        <p role="alert" className={styles.runError}>
          {runError}
        </p>
      )}
      {confirming && (
        <RunPipelineConfirm
          sha={runner.head.isSuccess ? runner.head.data : null}
          onRun={confirmRun}
          onCancel={cancelRun}
        />
      )}
      {restored ? (
        <p className={styles.note}>Open the pipeline again to load it.</p>
      ) : noProject ? (
        <p role="alert" className={styles.error}>
          The active repository has no GitLab project.
        </p>
      ) : list.isError ? (
        <p role="alert" className={styles.error}>
          {list.error.message}
        </p>
      ) : list.isSuccess && selected === null ? (
        <p className={styles.note}>No pipeline for this MR yet.</p>
      ) : selected !== null ? (
        <>
          <PipelineTabs tabs={tabs} selected={selected} onSelect={setPicked} controls={HEAD_ID} />
          {head.isError && (
            <p role="alert" className={styles.error}>
              {head.error.message}
            </p>
          )}
          {project !== undefined && (
            <PipelineJobs
              key={selected}
              project={project}
              iid={iid}
              pipeline={selected}
              jobs={jobs}
              sha={tabs.find((t) => t.id === selected)?.sha ?? null}
              refused={refused}
              onRefused={setRefused}
              onSelectPipeline={(number) => {
                const tab = tabs.find((t) => t.number === number);
                if (tab) setPicked(tab.id);
              }}
            />
          )}
        </>
      ) : null}
    </div>
  );
}
