import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-20.8: the artifacts of a successful job in the job details panel of S-08 (Pipeline.dc.html,
// M6 decision 13). Client: `jobArtifacts(project, iid, job): Promise<JobArtifact[]>` with
// `JobArtifact { name, size, url }` (size is the label "48 MB" / "212 KB", url the download URL).
//
// Locators the panel keeps: the text "Artifacts" (exact, the small heading), one `listitem` per
// artifact holding its name, its size and a <button> named exactly "Download" (it calls
// `osOpenGitlabUrl(url)` like Full log, so the browser's own GitLab sign-in does the download);
// "No artifacts." when a successful job has none.
//
// Decisions the tests lock (none is in the spec or the mock):
//  - Only a job whose state is `passed` shows the section and reads the artifacts; failed, running,
//    waiting, manual, canceled and skipped jobs show neither the heading nor the text, and the
//    client is not called for them.
//  - While the list loads the heading shows, with neither rows nor "No artifacts." (no false
//    empty state).
//  - A failed read shows "Couldn't load the artifacts. <reason>" as a status (not an alert: the
//    panel's one alert belongs to the log) in place of the rows, never "No artifacts.".

const IID = 482;
type Row = Awaited<ReturnType<IpcClient['pipelineJobs']>>[number]['jobs'][number];
type Artifact = Awaited<ReturnType<IpcClient['jobArtifacts']>>[number];

const APK: Artifact = {
  name: 'app-release.apk',
  size: '48 MB',
  url: 'https://gitlab.local/mobile/mobile-app/-/jobs/7/artifacts/download?file_type=archive',
};
const XML: Artifact = {
  name: 'report.xml',
  size: '212 KB',
  url: 'https://gitlab.local/mobile/mobile-app/-/jobs/7/artifacts/download?file_type=junit',
};

const row = (over: Partial<Row> & Pick<Row, 'id' | 'name'>): Row => ({
  state: 'passed',
  action: null,
  durationSecs: 372,
  webUrl: `https://gitlab.local/mobile/mobile-app/-/jobs/${String(over.id)}`,
  ...over,
});

async function openWith(rows: Row[], override: Partial<IpcClient> = {}) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const asked: number[] = [];
  const opened: string[] = [];
  const rec = recordingClient({
    ...base,
    pipelineJobs: () => Promise.resolve([{ name: 'build', jobs: rows }]),
    jobTrace: () => new Promise<void>(() => undefined),
    jobArtifacts: (_project, _iid, job) => {
      asked.push(job);
      return Promise.resolve([APK, XML]);
    },
    osOpenGitlabUrl: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
    ...override,
  });
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-08', iid: IID })));
  return { user: userEvent.setup(), asked, opened };
}

const panel = async () => screen.findByRole('region', { name: 'Job details' });

describe('S-08 job artifacts (F-20.8)', () => {
  it('F-20.8 a successful job lists each artifact with its name, size and Download', async () => {
    await openWith([row({ id: 7, name: 'build:android' })]);

    const details = within(await panel());
    expect(await details.findByText('Artifacts', { exact: true })).toBeInTheDocument();
    const items = await details.findAllByRole('listitem');
    expect(items).toHaveLength(2);
    const [apk, xml] = items;
    if (!apk || !xml) throw new Error('missing artifact rows');
    expect(within(apk).getByText('app-release.apk')).toBeInTheDocument();
    expect(within(apk).getByText('48 MB')).toBeInTheDocument();
    expect(within(apk).getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
    expect(within(xml).getByText('report.xml')).toBeInTheDocument();
    expect(within(xml).getByText('212 KB')).toBeInTheDocument();
    expect(details.queryByText('No artifacts.')).not.toBeInTheDocument();
  });

  it('F-20.8 the artifacts are read for the selected job', async () => {
    const { asked } = await openWith([row({ id: 7, name: 'build:android' })]);

    await within(await panel()).findAllByRole('listitem');

    expect(asked).toEqual([7]);
  });

  it('F-20.8 Download opens that artifact URL in the browser', async () => {
    const { user, opened } = await openWith([row({ id: 7, name: 'build:android' })]);

    const items = await within(await panel()).findAllByRole('listitem');
    const xml = items[1];
    if (!xml) throw new Error('missing artifact row');
    await user.click(within(xml).getByRole('button', { name: 'Download', exact: true }));

    expect(opened).toEqual([XML.url]);
  });

  it('F-20.8 a successful job without artifacts says No artifacts.', async () => {
    await openWith([row({ id: 7, name: 'sonar' })], { jobArtifacts: () => Promise.resolve([]) });

    const details = within(await panel());
    expect(await details.findByText('No artifacts.')).toBeInTheDocument();
    expect(details.getByText('Artifacts', { exact: true })).toBeInTheDocument();
    expect(details.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
  });

  it.each([
    ['failed', 'retry'],
    ['failedAllowed', 'retry'],
    ['running', 'cancel'],
    ['waiting', null],
    ['manual', 'run'],
    ['canceled', 'retry'],
    ['skipped', null],
  ] as const)('F-20.8 a %s job shows no artifacts and reads none', async (state, action) => {
    const { asked } = await openWith([row({ id: 7, name: 'build:android', state, action })]);

    const details = within(await panel());
    expect(await details.findByTestId('job-status')).toBeInTheDocument();
    // Success is the one state that lists artifacts; give a wrong read time to show up.
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(details.queryByText('Artifacts', { exact: true })).not.toBeInTheDocument();
    expect(details.queryByText('No artifacts.')).not.toBeInTheDocument();
    expect(asked).toEqual([]);
  });

  it('F-20.8 while the list loads there are neither rows nor the empty copy', async () => {
    await openWith([row({ id: 7, name: 'build:android' })], {
      jobArtifacts: () => new Promise<Artifact[]>(() => undefined),
    });

    const details = within(await panel());
    expect(await details.findByText('Artifacts', { exact: true })).toBeInTheDocument();
    expect(details.queryByRole('listitem')).not.toBeInTheDocument();
    expect(details.queryByText('No artifacts.')).not.toBeInTheDocument();
  });

  it('F-20.8 a failed read says so as a status, not as an empty list', async () => {
    await openWith([row({ id: 7, name: 'build:android' })], {
      jobArtifacts: () =>
        Promise.reject(
          new IpcError({ code: 'GITLAB_NOT_FOUND', message: 'It is gone.', retryable: false }),
        ),
    });

    const details = within(await panel());
    const status = await details.findByText("Couldn't load the artifacts. It is gone.");
    expect(status).toHaveAttribute('role', 'status');
    expect(details.queryByRole('listitem')).not.toBeInTheDocument();
    expect(details.queryByText('No artifacts.')).not.toBeInTheDocument();
  });
});
