import type { JobArtifact } from '../../types/JobArtifact';
import { jobPage } from './pipelineLog';

/** The files of !482's passed jobs by job name (Pipeline.dc.html's ARTS) with their GitLab kind. */
const ARTS: Readonly<Record<string, readonly { name: string; size: string; kind: string }[]>> = {
  'build:android': [{ name: 'app-release.apk', size: '48 MB', kind: 'archive' }],
  'build:ios': [{ name: 'App.ipa', size: '61 MB', kind: 'archive' }],
  'unit-tests': [{ name: 'report.xml', size: '212 KB', kind: 'junit' }],
};

/** The artifacts of job `id` named `name`, as `job_artifacts` answers them (F-20.8). */
export function jobArtifacts(id: number, name: string): JobArtifact[] {
  return (ARTS[name] ?? []).map((a) => ({
    name: a.name,
    size: a.size,
    url: `${jobPage(id)}/artifacts/download?file_type=${a.kind}`,
  }));
}
