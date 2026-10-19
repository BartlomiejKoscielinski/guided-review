import { describe, expect, it } from 'vitest';
import { createMockClient } from '.';
import { formatAge } from '../../format/age';

// F-20.1 in the mock backend, as the core answers `pipeline_list(project, iid)` and
// `pipeline_get(project, iid, id)` (plan M6): the pipelines of !482 as Pipeline.dc.html lists them
// (#18342, #18321, #18320; the mock's fourth, #18351, is the new pipeline of F-20.3). Mock data
// matches the mock:
//   #18342  a3f9c12  version 3  latest  Passed    Marta K. · 2 h ago · 14 min  1 allowed failure
//   #18321  6a02f9e  version 2          Failed    Marta K. · 3 h ago · 9 min
//   #18320  6a02f9e  version 2          Canceled  Marta K. · 3 h ago (no duration: "canceled by
//                                                  a newer push" is not data GitLab's REST gives)
// Shapes (the core's PipelineTab and PipelineHead in camelCase): `sha` is the full SHA, `number`
// is the pipeline id, `startedAt` an ISO time and `durationSecs` seconds, both `null` when GitLab
// has none yet; the screen formats the age and the duration.

const PROJECT = 'mobile/mobile-app';
const IID = 482;

async function backend() {
  const mock = createMockClient({ latencyMs: 0 });
  await mock.repoPick();
  return mock;
}

describe('mock pipelines (F-20.1)', () => {
  it('F-20.1 pipelineList lists the three pipelines of !482 newest first, only the newest latest', async () => {
    const mock = await backend();

    const tabs = await mock.pipelineList(PROJECT, IID);

    expect(tabs.map((t) => t.id)).toEqual([18342, 18321, 18320]);
    expect(tabs.map((t) => t.number)).toEqual([18342, 18321, 18320]);
    expect(tabs.map((t) => t.latest)).toEqual([true, false, false]);
    expect(tabs.map((t) => t.version)).toEqual([3, 2, 2]);
    expect(tabs.map((t) => t.status)).toEqual(['passed', 'failed', 'canceled']);
  });

  it('F-20.1 the tabs carry the full SHAs of the mock: a3f9c12 for version 3, 6a02f9e for version 2', async () => {
    const mock = await backend();

    const tabs = await mock.pipelineList(PROJECT, IID);

    expect(tabs[0]?.sha).toMatch(/^a3f9c12[0-9a-f]{33}$/);
    expect(tabs[1]?.sha).toMatch(/^6a02f9e[0-9a-f]{33}$/);
    expect(tabs[2]?.sha).toBe(tabs[1]?.sha);
  });

  it('F-20.1 pipelineGet of #18342 is Passed with 1 allowed failure, version 3, by Marta K., 14 min', async () => {
    const mock = await backend();

    const head = await mock.pipelineGet(PROJECT, IID, 18342);

    expect(head).toMatchObject({
      status: 'passed',
      allowedFailures: 1,
      number: 18342,
      kind: 'Merge request pipeline',
      version: 3,
      author: 'Marta K.',
      startedByMe: false,
      durationSecs: 14 * 60,
    });
    expect(head.sha).toMatch(/^a3f9c12/);
    expect(formatAge(head.startedAt ?? '')).toBe('2 h ago');
  });

  it('F-20.1 pipelineGet of #18321 is Failed without an allowed-failure count, version 2, 9 min', async () => {
    const mock = await backend();

    const head = await mock.pipelineGet(PROJECT, IID, 18321);

    expect(head).toMatchObject({
      status: 'failed',
      allowedFailures: 0,
      number: 18321,
      kind: 'Merge request pipeline',
      version: 2,
      author: 'Marta K.',
      startedByMe: false,
      durationSecs: 9 * 60,
    });
    expect(head.sha).toMatch(/^6a02f9e/);
    expect(formatAge(head.startedAt ?? '')).toBe('3 h ago');
  });

  it('F-20.1 pipelineGet of #18320 is Canceled and has no duration', async () => {
    const mock = await backend();

    const head = await mock.pipelineGet(PROJECT, IID, 18320);

    expect(head).toMatchObject({
      status: 'canceled',
      allowedFailures: 0,
      number: 18320,
      version: 2,
      author: 'Marta K.',
      startedByMe: false,
      durationSecs: null,
    });
    expect(formatAge(head.startedAt ?? '')).toBe('3 h ago');
  });

  it('F-20.1 each tab and its head agree on the status, the SHA and the version', async () => {
    const mock = await backend();

    for (const tab of await mock.pipelineList(PROJECT, IID)) {
      const head = await mock.pipelineGet(PROJECT, IID, tab.id);
      expect(head.status, `#${String(tab.id)}`).toBe(tab.status);
      expect(head.sha, `#${String(tab.id)}`).toBe(tab.sha);
      expect(head.version, `#${String(tab.id)}`).toBe(tab.version);
    }
  });
});
