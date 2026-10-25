import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';

// F-20.8 in the mock backend, as the core answers `job_artifacts(project, iid, job)` (plan M6,
// decision 13): the client call is `jobArtifacts(project, iid, job)` -> `{ name, size, url }[]`.
// The files are those of Pipeline.dc.html (ARTS): build:android has app-release.apk 48 MB,
// build:ios App.ipa 61 MB, unit-tests report.xml 212 KB; any other passed job has none. Job ids
// are `<pipeline><index>` (#18342: build:android 1834202, build:ios 1834203, unit-tests 1834204,
// sonar 1834208). The URL is the job's page plus `/artifacts/download?file_type=<type>`.

const PROJECT = 'mobile/mobile-app';
const IID = 482;

async function backend() {
  const mock = createMockClient({ latencyMs: 0 });
  await mock.repoPick();
  return mock;
}

describe('mock job artifacts (F-20.8)', () => {
  it('F-20.8 build:android of #18342 has app-release.apk of 48 MB', async () => {
    const mock = await backend();

    const list = await mock.jobArtifacts(PROJECT, IID, 1834202);

    expect(list.map((a) => [a.name, a.size])).toEqual([['app-release.apk', '48 MB']]);
  });

  it('F-20.8 build:ios has App.ipa of 61 MB and unit-tests report.xml of 212 KB', async () => {
    const mock = await backend();

    const ios = await mock.jobArtifacts(PROJECT, IID, 1834203);
    const tests = await mock.jobArtifacts(PROJECT, IID, 1834204);

    expect(ios.map((a) => [a.name, a.size])).toEqual([['App.ipa', '61 MB']]);
    expect(tests.map((a) => [a.name, a.size])).toEqual([['report.xml', '212 KB']]);
  });

  it('F-20.8 a passed job without files has no artifacts', async () => {
    const mock = await backend();

    expect(await mock.jobArtifacts(PROJECT, IID, 1834208)).toEqual([]);
  });

  it('F-20.8 the download URL is the job page with the artifacts download path', async () => {
    const mock = await backend();

    const [apk] = await mock.jobArtifacts(PROJECT, IID, 1834202);

    expect(apk?.url).toMatch(/\/-\/jobs\/1834202\/artifacts\/download\?file_type=[a-z0-9_]+$/);
  });
});
