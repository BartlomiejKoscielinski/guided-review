import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import { createMockClient, type MockOptions } from '../../ipc/mock';
import type { FileDiff } from '../../ipc/types/FileDiff';
import type { Line } from '../../ipc/types/Line';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// F-08.5: the sticky file bar at the top of each file of the S-04 step (Main.dc.html): the path with
// the file name in bold, `+add −del`, Split | Unified, Ignore whitespace and Open in Rider. Split |
// Unified and Ignore whitespace are one value for the whole Detailed view, kept for the app run,
// default Split with whitespace shown; Focus stays split; Ignore whitespace is display only
// (M4 decision 5). Sticking on top while scrolling is in tests/e2e/detailed.spec.ts.

const SESSION = 'mock-mr-session-1';
const DETAILED = pathFor({ screen: 'S-04', sessionId: SESSION });
const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';

type MockStorage = NonNullable<MockOptions['storage']>;

function memoryStorage(): MockStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

/** A mock backend of its own, with the plan prepared as S-02 does. */
async function backend(): Promise<IpcClient> {
  const client = createMockClient({ latencyMs: 0, storage: memoryStorage() });
  await client.reviewPlan(SESSION, () => undefined);
  return client;
}

async function openDetailed(client: Partial<IpcClient>, step: string) {
  const app = renderApp({ screen: 'S-04', sessionId: SESSION }, client);
  await app.router.navigate(`${DETAILED}?step=${step}`);
  await screen.findByRole('heading', { level: 1 });
  return app;
}

/** S-04's main column (the step and its files), inside the shell's main. */
function mainColumn(): HTMLElement {
  const main = document.querySelector<HTMLElement>('main main');
  if (!main) throw new Error('no S-04 main column');
  return main;
}
const column = () => within(mainColumn());
const layouts = () => column().getAllByRole('radiogroup', { name: 'Diff layout' });
const whitespace = () => column().getAllByRole('button', { name: 'Ignore whitespace' });
const radio = (group: HTMLElement | undefined, name: string) => {
  if (!group) throw new Error('no Diff layout group');
  return within(group).getByRole('radio', { name });
};
const unifiedRows = () => mainColumn().querySelectorAll('[class*="unified"][data-kind]');
const splitRows = () => mainColumn().querySelectorAll('[class*="split"] [data-kind]');
const ctrlD = () => userEvent.keyboard('{Control>}d{/Control}');

const ctx = (o: number, n: number, text: string): Line => ({
  kind: 'ctx',
  oldNo: o,
  newNo: n,
  text,
  emphasis: [],
});
const del = (o: number, text: string): Line => ({ kind: 'del', oldNo: o, text, emphasis: [] });
const add = (n: number, text: string): Line => ({ kind: 'add', newNo: n, text, emphasis: [] });

/** Step 4's file with an indentation-only change (old 11 / new 21) and a real one (12 / 22). */
const WHITESPACE_FILE: FileDiff = {
  oldPath: VM,
  newPath: VM,
  status: 'modified',
  binary: false,
  additions: 2,
  deletions: 2,
  layer: 'app',
  lineStaging: false,
  hunks: [
    {
      id: `${VM}#ws`,
      oldStart: 10,
      oldLines: 4,
      newStart: 20,
      newLines: 4,
      header: 'PendingCount',
      fileLevel: false,
      stagedDiffers: false,
      lines: [
        ctx(10, 20, '{'),
        del(11, '    return queue;'),
        add(21, '        return queue;'),
        del(12, 'var count = 1;'),
        add(22, 'var count = 2;'),
        ctx(13, 23, '}'),
      ],
    },
  ],
};

const line = (kind: Line['kind'], no: number) =>
  mainColumn().querySelector(`[data-kind="${kind}"] [data-line-no="${String(no)}"]`);

describe('S-04 file bar (F-08.5)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    // jsdom lays nothing out; give elements a size so the virtualizer renders rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-08.5 the bar shows the path with the file name in bold, +add −del, Split | Unified, Ignore whitespace and Open in Rider', async () => {
    await openDetailed(await backend(), 's4');
    await column().findByRole('button', { name: 'Open in Rider' });

    const name = column().getByText('DeliveryPhotoViewModel.cs', { selector: 'b' });
    expect(name.parentElement).toHaveTextContent(VM);
    expect(column().getByText('+34', { exact: true })).toBeInTheDocument();
    // U+2212 MINUS SIGN, as in the mock and the S-03 file header.
    expect(column().getByText('−22', { exact: true })).toBeInTheDocument();

    const [layout] = layouts();
    expect(
      within(layout ?? document.body)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Split', 'Unified']);
    // Default: Split, whitespace shown.
    expect(radio(layout, 'Split')).toBeChecked();
    expect(radio(layout, 'Unified')).not.toBeChecked();
    expect(whitespace()).toHaveLength(1);
    expect(whitespace()[0]).toHaveAttribute('aria-pressed', 'false');
    expect(splitRows().length).toBeGreaterThan(0);
    expect(unifiedRows()).toHaveLength(0);
  });

  it('F-08.5 every file has its bar; Split | Unified and Ignore whitespace are one value for the view, kept on other steps', async () => {
    const { router } = await openDetailed(await backend(), 's1');
    await waitFor(() => {
      expect(column().getAllByRole('button', { name: 'Open in Rider' })).toHaveLength(2);
    });
    expect(column().getByText('IUploadQueue.cs', { selector: 'b' })).toBeInTheDocument();
    expect(column().getByText('QueuedPhoto.cs', { selector: 'b' })).toBeInTheDocument();
    expect(layouts()).toHaveLength(2);

    // Unified on the first file's bar: every bar reads Unified and every file is unified.
    await userEvent.click(radio(layouts()[0], 'Unified'));
    for (const group of layouts()) expect(radio(group, 'Unified')).toBeChecked();
    await waitFor(() => {
      expect(unifiedRows().length).toBeGreaterThan(0);
    });
    expect(splitRows()).toHaveLength(0);

    // Ignore whitespace on the second file's bar: pressed on every bar.
    await userEvent.click(whitespace()[1] ?? document.body);
    for (const button of whitespace()) expect(button).toHaveAttribute('aria-pressed', 'true');

    // Another step keeps both values.
    await router.navigate(`${DETAILED}?step=s4`);
    await column().findByText('DeliveryPhotoViewModel.cs', { selector: 'b' });
    expect(radio(layouts()[0], 'Unified')).toBeChecked();
    expect(whitespace()[0]).toHaveAttribute('aria-pressed', 'true');
    expect(unifiedRows().length).toBeGreaterThan(0);

    // Focus stays split (F-07.4); back in Detailed the values are still there.
    await ctrlD();
    expect(await screen.findByText('Step 4 of 8')).toBeInTheDocument();
    expect(document.querySelectorAll('[class*="unified"][data-kind]')).toHaveLength(0);
    await ctrlD();
    await column().findByText('DeliveryPhotoViewModel.cs', { selector: 'b' });
    expect(radio(layouts()[0], 'Unified')).toBeChecked();
    expect(whitespace()[0]).toHaveAttribute('aria-pressed', 'true');

    // Back to the defaults: the values live for the app run, so the next test starts from them.
    await userEvent.click(radio(layouts()[0], 'Split'));
    await userEvent.click(whitespace()[0] ?? document.body);
    expect(radio(layouts()[0], 'Split')).toBeChecked();
    expect(whitespace()[0]).toHaveAttribute('aria-pressed', 'false');
  });

  it('F-08.5 Ignore whitespace shows an indentation-only change as one unchanged line; the real change and +/− stay', async () => {
    const client = await backend();
    const reviewStep: IpcClient['reviewStep'] = async (sessionId, stepId) => {
      const view = await client.reviewStep(sessionId, stepId);
      return stepId === 's4' ? { ...view, files: [WHITESPACE_FILE] } : view;
    };
    await openDetailed({ ...client, reviewStep }, 's4');
    await waitFor(() => {
      expect(line('del', 11)).not.toBeNull();
    });
    expect(line('add', 21)).not.toBeNull();

    const button = column().getByRole('button', { name: 'Ignore whitespace' });
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => {
      expect(line('del', 11)).toBeNull();
    });
    expect(line('add', 21)).toBeNull();
    // One unchanged line with both of its numbers.
    expect(line('ctx', 11)).not.toBeNull();
    expect(line('ctx', 21)).not.toBeNull();
    // The real change is kept, and the bar still counts the file's lines.
    expect(line('del', 12)).not.toBeNull();
    expect(line('add', 22)).not.toBeNull();
    expect(column().getByText('+2', { exact: true })).toBeInTheDocument();
    expect(column().getByText('−2', { exact: true })).toBeInTheDocument();

    // Off again: the change shows as before.
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => {
      expect(line('del', 11)).not.toBeNull();
    });
    expect(line('add', 21)).not.toBeNull();
  });

  it('F-08.5 Open in Rider opens the file at its first hunk from the session’s folder (F-24.1)', async () => {
    const riderOpen = vi.fn<IpcClient['riderOpen']>(() => Promise.resolve());
    await openDetailed({ ...(await backend()), riderOpen }, 's4');
    await userEvent.click(await column().findByRole('button', { name: 'Open in Rider' }));
    await waitFor(() => {
      expect(riderOpen).toHaveBeenCalledWith(VM, 12, SESSION);
    });
    expect(riderOpen).toHaveBeenCalledTimes(1);
    expect(column().queryByRole('alert')).toBeNull();
  });

  it('F-08.5 Open in Rider failing shows the error under the bar', async () => {
    const riderOpen = vi.fn<IpcClient['riderOpen']>(() =>
      Promise.reject(
        new IpcError({
          code: 'INTERNAL',
          message: 'Rider could not be started.',
          retryable: false,
        }),
      ),
    );
    await openDetailed({ ...(await backend()), riderOpen }, 's4');
    await userEvent.click(await column().findByRole('button', { name: 'Open in Rider' }));
    expect(await column().findByRole('alert')).toHaveTextContent('Rider could not be started.');
  });
});
