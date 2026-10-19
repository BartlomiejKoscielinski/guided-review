import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient } from '../../ipc/mock';
import { recordingClient, renderApp } from '../../test/renderApp';

// F-20.6: the manual-job form in the job details panel of S-08 (Pipeline.dc.html, M6 decision 11).
// A manual job of #18342 (ui-tests:ios-device, distribute:qa) selected: <section aria-label="Job
// details"> shows "Variables for this run", one row per variable (inputs "Variable name" and
// "Variable value", a remove button named "Remove variable ..."), the button "+ Add variable", the
// button "Run <job>" and the text "Runs on a3f9c12 as you." (the pipeline head's SHA, seven
// characters). No log is shown for a manual job.
//
// Client: `jobVariablesGet(project, jobName) -> {key, value}[]` (read when the form opens) and
// `jobPlay(project, iid, jobId, vars) -> JobRow`. The row's own button is "Run <job>" too
// (F-20.2): it only selects the job; the form's button is the one inside the Job details panel.
//
// Decisions the tests lock (neither the spec nor the mock gives them):
//  - Empty at first means no variable rows at all (the mock's example row is example data).
//  - The description line is not shown: the Jobs API sends none (plan), so the mock's example
//    sentence never appears.
//  - A row with an invalid or empty name and a value, or an invalid non-empty name, blocks Run
//    (disabled) and shows "Letters, digits and _ only."; a row with both fields empty is dropped;
//    a valid name with an empty value is sent with the empty value.
//  - Run sends jobPlay once; while it is in flight the button is disabled with aria-busy="true".
//    A failure shows "Couldn't run the job. <reason>" as the one role="alert", keeps the typed
//    rows and leaves Run ready.
//  - After a successful play the form is gone and the job's row reads Waiting.

const IID = 482;
const PROJECT = 'mobile/mobile-app';
const IOS = 'ui-tests:ios-device';
type Row = Awaited<ReturnType<IpcClient['pipelineJobs']>>[number]['jobs'][number];
type Vars = Parameters<IpcClient['jobPlay']>[3];
type User = ReturnType<typeof userEvent.setup>;
type Form = ReturnType<typeof within>;

/** What the core answers after a play: the same job, now waiting. */
const playedRow = (id: number): Row => ({
  id,
  name: IOS,
  state: 'waiting',
  action: 'cancel',
  durationSecs: null,
  webUrl: null,
});

async function open(override: (base: IpcClient) => Partial<IpcClient> = () => ({})) {
  const base = createMockClient({ latencyMs: 0 });
  await base.repoPick();
  const columns = await base.pipelineJobs(PROJECT, IID, 18342);
  const jobs = columns.flatMap((c) => c.jobs);
  const id = (name: string): number => jobs.find((j) => j.name === name)?.id ?? -1;
  const rec = recordingClient({
    ...base,
    jobTrace: () => new Promise<void>(() => undefined),
    ...override(base),
  });
  const app = renderApp({ screen: 'S-01' }, rec.client);
  await act(() => app.router.navigate(pathFor({ screen: 'S-08', iid: IID })));
  await screen.findByRole('button', { name: `${IOS}, Manual` });
  return { user: userEvent.setup(), id, calls: rec.calls };
}

const panel = () => screen.findByRole('region', { name: 'Job details' });

async function openForm(name: string, setup: Parameters<typeof open>[0] = () => ({})) {
  const app = await open(setup);
  await app.user.click(screen.getByRole('button', { name: `${name}, Manual` }));
  await screen.findByText('Variables for this run');
  const form: Form = within(await panel());
  return { ...app, form };
}

const values = (form: Form, label: string) =>
  form.queryAllByLabelText(label).map((i) => (i as HTMLInputElement).value);

async function addRow(user: User, form: Form, key: string, value: string) {
  await user.click(form.getByRole('button', { name: '+ Add variable' }));
  const k = form.getAllByLabelText('Variable name').at(-1);
  const v = form.getAllByLabelText('Variable value').at(-1);
  if (k === undefined || v === undefined) throw new Error('no new row');
  if (key !== '') await user.type(k, key);
  if (value !== '') await user.type(v, value);
}

const played = () => vi.fn<IpcClient['jobPlay']>((...a) => Promise.resolve(playedRow(a[2])));

describe('S-08 manual job form (F-20.6)', () => {
  it('F-20.6 a manual job shows the form: Variables for this run, + Add variable, Run <job> and where it runs', async () => {
    const { form } = await openForm(IOS);

    expect(form.getByText('Variables for this run')).toBeInTheDocument();
    expect(form.getByRole('button', { name: '+ Add variable' })).toBeInTheDocument();
    expect(form.getByRole('button', { name: `Run ${IOS}` })).toBeEnabled();
    await waitFor(async () => {
      expect(await panel()).toHaveTextContent('Runs on a3f9c12 as you.');
    });
    expect(form.queryByRole('log', { name: 'Job log' })).toBeNull();
  });

  it('F-20.6 a job that is not manual has no form', async () => {
    await open();
    const details = within(await panel());

    expect(details.queryByText('Variables for this run')).toBeNull();
    expect(details.queryByRole('button', { name: '+ Add variable' })).toBeNull();
  });

  it('F-20.6 the description line is not shown: the Jobs API gives none', async () => {
    const { form } = await openForm(IOS);

    expect(form.queryByText(/physical iPhone/)).toBeNull();
  });

  it('F-20.6 the variables are empty at first for a job name never played', async () => {
    const { form, calls } = await openForm(IOS);

    expect(form.queryAllByLabelText('Variable name')).toHaveLength(0);
    expect(form.queryAllByLabelText('Variable value')).toHaveLength(0);
    expect(calls).toContain('jobVariablesGet');
  });

  it('F-20.6 the form opens with the last values used for that project and job name', async () => {
    const jobVariablesGet = vi.fn<IpcClient['jobVariablesGet']>(() =>
      Promise.resolve([
        { key: 'DEVICE', value: 'iPhone 15' },
        { key: 'RETRIES', value: '2' },
      ]),
    );
    const { form } = await openForm(IOS, () => ({ jobVariablesGet }));

    await waitFor(() => {
      expect(values(form, 'Variable name')).toEqual(['DEVICE', 'RETRIES']);
    });
    expect(values(form, 'Variable value')).toEqual(['iPhone 15', '2']);
    expect(jobVariablesGet).toHaveBeenCalledWith(PROJECT, IOS);
  });

  it('F-20.6 + Add variable adds an empty row and the remove button takes a row away', async () => {
    const { user, form } = await openForm(IOS);

    await addRow(user, form, 'A', '1');
    await addRow(user, form, 'B', '2');
    expect(values(form, 'Variable name')).toEqual(['A', 'B']);

    const removes = form.getAllByRole('button', { name: /^Remove variable/ });
    expect(removes).toHaveLength(2);
    const first = removes[0];
    if (first === undefined) throw new Error('no remove button');
    await user.click(first);

    expect(values(form, 'Variable name')).toEqual(['B']);
  });

  it('F-20.6 Run sends the typed variables to the job once and drops an empty row', async () => {
    const jobPlay = played();
    const { user, form, id } = await openForm(IOS, () => ({ jobPlay }));
    await addRow(user, form, 'DEVICE', 'iPhone 16');
    await addRow(user, form, '', '');
    await addRow(user, form, 'EMPTY_VALUE', '');

    await user.click(form.getByRole('button', { name: `Run ${IOS}` }));

    await waitFor(() => {
      expect(jobPlay).toHaveBeenCalledTimes(1);
    });
    const vars: Vars = [
      { key: 'DEVICE', value: 'iPhone 16' },
      { key: 'EMPTY_VALUE', value: '' },
    ];
    expect(jobPlay).toHaveBeenCalledWith(PROJECT, IID, id(IOS), vars);
  });

  it('F-20.6 a manual job without variables runs with an empty list', async () => {
    const jobPlay = played();
    const { user, form, id } = await openForm('distribute:qa', () => ({ jobPlay }));

    await user.click(form.getByRole('button', { name: 'Run distribute:qa' }));

    await waitFor(() => {
      expect(jobPlay).toHaveBeenCalledWith(PROJECT, IID, id('distribute:qa'), []);
    });
  });

  it('F-20.6 an invalid variable name blocks Run and says Letters, digits and _ only.', async () => {
    const jobPlay = played();
    const { user, form } = await openForm(IOS, () => ({ jobPlay }));

    await addRow(user, form, 'bad name', '1');

    expect(form.getByText('Letters, digits and _ only.')).toBeInTheDocument();
    const run = form.getByRole('button', { name: `Run ${IOS}` });
    expect(run).toBeDisabled();
    await user.click(run);
    expect(jobPlay).not.toHaveBeenCalled();

    const name = form.getByLabelText('Variable name');
    await user.clear(name);
    await user.type(name, 'good_name_2');

    expect(form.queryByText('Letters, digits and _ only.')).toBeNull();
    expect(form.getByRole('button', { name: `Run ${IOS}` })).toBeEnabled();
  });

  it('F-20.6 a value without a name blocks Run, an invalid name with no value too, and a fully empty row does not', async () => {
    const { user, form } = await openForm(IOS);

    await addRow(user, form, '', 'orphan');
    expect(form.getByText('Letters, digits and _ only.')).toBeInTheDocument();
    expect(form.getByRole('button', { name: `Run ${IOS}` })).toBeDisabled();

    await user.click(form.getByRole('button', { name: /^Remove variable/ }));
    await addRow(user, form, 'a-b', '');
    expect(form.getByRole('button', { name: `Run ${IOS}` })).toBeDisabled();

    await user.click(form.getByRole('button', { name: /^Remove variable/ }));
    await addRow(user, form, '', '');
    expect(form.queryByText('Letters, digits and _ only.')).toBeNull();
    expect(form.getByRole('button', { name: `Run ${IOS}` })).toBeEnabled();
  });

  it('F-20.6 the row’s Run button only selects the job: the form opens and nothing is played', async () => {
    const jobPlay = played();
    const { user } = await open(() => ({ jobPlay }));

    await user.click(screen.getByRole('button', { name: 'Run distribute:qa' }));

    const details = within(await panel());
    expect(await details.findByText('Variables for this run')).toBeInTheDocument();
    expect(details.getByRole('button', { name: 'Run distribute:qa' })).toBeInTheDocument();
    expect(jobPlay).not.toHaveBeenCalled();
  });

  it('F-20.6 while the play is on its way Run is disabled and busy, and a second click sends nothing', async () => {
    let finish: (row: Row) => void = () => undefined;
    const jobPlay = vi.fn<IpcClient['jobPlay']>(
      () =>
        new Promise<Row>((resolve) => {
          finish = resolve;
        }),
    );
    const { user, form, id } = await openForm(IOS, () => ({ jobPlay }));
    const run = form.getByRole('button', { name: `Run ${IOS}` });

    await user.click(run);
    await user.click(run);

    expect(jobPlay).toHaveBeenCalledTimes(1);
    expect(form.getByRole('button', { name: `Run ${IOS}` })).toBeDisabled();
    expect(form.getByRole('button', { name: `Run ${IOS}` })).toHaveAttribute('aria-busy', 'true');
    await act(() => {
      finish(playedRow(id(IOS)));
      return Promise.resolve();
    });
  });

  it('F-20.6 a failed play says why, keeps the typed rows and leaves Run ready', async () => {
    const jobPlay = vi.fn<IpcClient['jobPlay']>(() =>
      Promise.reject(new IpcError({ code: 'GITLAB_ERROR', message: 'boom', retryable: false })),
    );
    const { user, form } = await openForm(IOS, () => ({ jobPlay }));
    await addRow(user, form, 'DEVICE', 'iPhone 16');

    await user.click(form.getByRole('button', { name: `Run ${IOS}` }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't run the job. boom");
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(values(form, 'Variable name')).toEqual(['DEVICE']);
    expect(values(form, 'Variable value')).toEqual(['iPhone 16']);
    expect(form.getByRole('button', { name: `Run ${IOS}` })).toBeEnabled();
  });

  it('F-20.6 after a successful play the form is gone and the job reads Waiting', async () => {
    const { user, form } = await openForm(IOS);
    await addRow(user, form, 'DEVICE', 'iPhone 16');

    await user.click(form.getByRole('button', { name: `Run ${IOS}` }));

    expect(await screen.findByRole('button', { name: `${IOS}, Waiting` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `${IOS}, Manual` })).toBeNull();
    await waitFor(() => {
      expect(
        within(screen.getByRole('region', { name: 'Job details' })).queryByText(
          'Variables for this run',
        ),
      ).toBeNull();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
