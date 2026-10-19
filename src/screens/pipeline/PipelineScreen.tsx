import { useState } from 'react';
import { useLocation, useParams } from 'react-router';
import type { StartState } from '../../app/router';
import {
  hasActiveJob,
  usePipelineHead,
  usePipelineJobs,
  usePipelineList,
} from '../../ipc/hooks/usePipeline';
import { useRepos } from '../../ipc/hooks/useRepos';
import { PipelineHeader } from './PipelineHeader';
import { PipelineJobs } from './PipelineJobs';
import { PipelineTabs } from './PipelineTabs';
import styles from './Pipeline.module.css';

const HEAD_ID = 'pipeline-head';

/**
 * S-08 Pipeline (F-20.1): the MR's pipelines as tabs, newest first, and the selected pipeline's
 * status block and meta line, read from the active repository's GitLab project; its stage
 * columns (F-20.2), with the head and the jobs read again every 5 s while a job runs or waits. A restored start
 * reads nothing (F-30.4); it asks to open the pipeline again.
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

  return (
    <div className={styles.screen}>
      <PipelineHeader head={head.data} id={HEAD_ID} />
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
            />
          )}
        </>
      ) : null}
    </div>
  );
}
