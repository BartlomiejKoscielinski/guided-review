import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { App } from '../app/App';
import { createQueryClient } from '../app/queryClient';
import { createAppRouter } from '../app/router';
import type { IpcClient } from '../ipc/client';
import { IpcProvider } from '../ipc/IpcProvider';
import { createMockClient, MOCK_SESSION_DATA_KEY } from '../ipc/mock';
import type { GitlabUser } from '../ipc/types/GitlabUser';
import type { Mode } from '../ipc/types/Mode';
import type { Thread } from '../ipc/types/Thread';
import type { ThreadPosition } from '../ipc/types/ThreadPosition';
import { useFocusStore } from '../state/focus';

// Shared set-up of the F-13.2 Vitest files (S-05's Threads tab rows): the MR session of the mock
// backend with the given threads as its GitLab state (so `reviewStep` places them exactly as it
// does for !482), S-05 opened the way Finish review opens it, and the row of a thread by its text.

export const SESSION = 'mock-mr-session-1';

export const PAWEL: GitlabUser = { username: 'pawel.s', name: 'Paweł S.' };
export const MARTA: GitlabUser = { username: 'marta.k', name: 'Marta K.' };
export const ANNA: GitlabUser = { username: 'anna.k', name: 'Anna K.' };
export const OLA: GitlabUser = { username: 'ola.m', name: 'Ola M.' };
/** The mock backend's signed-in GitLab user (`gitlabStatus().user`). */
export const ME: GitlabUser = { username: 'bartek.k', name: 'Bartek K.' };

export const VM = 'src/Mobile.App/ViewModels/DeliveryPhotoViewModel.cs';
export const QUEUE = 'src/Mobile.Infrastructure/Uploads/SqliteUploadQueue.cs';
export const WORKER = 'src/Mobile.Infrastructure/Uploads/UploadWorker.cs';
export const XAML = 'src/Mobile.App/Views/DeliveryPhotoPage.xaml';

export interface ThreadSpec {
  id: string;
  /** The first message. */
  body: string;
  by?: GitlabUser;
  /** Who wrote each reply, in order. */
  replies?: GitlabUser[];
  resolved?: boolean;
  /** Where it sits; none for a comment on the MR itself. */
  at?: { file: string; line: number } | ThreadPosition;
}

const isPosition = (at: NonNullable<ThreadSpec['at']>): at is ThreadPosition => 'newPath' in at;

let noteId = 1000;

/** A resolvable thread of the MR as GitLab sends it. */
export function thread({
  id,
  body,
  by = PAWEL,
  replies = [],
  resolved = false,
  at,
}: ThreadSpec): Thread {
  const position: ThreadPosition | undefined = !at
    ? undefined
    : isPosition(at)
      ? at
      : {
          oldPath: at.file,
          newPath: at.file,
          newLine: at.line,
          headSha: '9c41e07',
          baseSha: '5e2a9c4',
        };
  return {
    id,
    resolvable: true,
    resolved,
    outdated: false,
    ...(position ? { position } : {}),
    notes: [by, ...replies].map((author, n) => ({
      id: (noteId += 1),
      author,
      body: n === 0 ? body : `Reply ${String(n)} to ${id}`,
      createdAt: `2026-10-12T${String(9 + n).padStart(2, '0')}:14:00.000Z`,
    })),
  };
}

function memoryStorage(entries: Record<string, string>): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

export interface OpenOptions {
  /** The session's mode (Back to steps and Show in code open this one). */
  mode?: Mode;
  /** Runs on the client the app gets, before it renders: spies and overrides go here. */
  prepare?: (client: IpcClient) => void;
}

export interface Opened {
  client: IpcClient;
  router: ReturnType<typeof createAppRouter>;
}

/**
 * S-05 of the MR session, on its Threads tab (no drafts), with `threads` as the mock GitLab's
 * threads. Resolve and Reopen change that state, as on GitLab. The way the user gets there: step 4
 * is shown first (S-03, or S-04 in a Detailed session), so the plan and that step are cached, and
 * Finish review opens the summary.
 */
export async function openSummary(
  threads: Thread[],
  { mode, prepare }: OpenOptions = {},
): Promise<Opened> {
  const storage = memoryStorage({ [MOCK_SESSION_DATA_KEY]: JSON.stringify({ threads }) });
  const base = createMockClient({ latencyMs: 0, storage });
  await base.repoPick();
  await base.reviewPlan(SESSION, () => undefined);
  if (mode) await base.sessionSetMode(SESSION, mode);
  const client: IpcClient = { ...base };
  prepare?.(client);
  // jsdom lays nothing out; give elements a size so the step screens' virtualizers render rows.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  useFocusStore.setState({ layout: 'A' });
  const router = createAppRouter({ screen: 'S-01' });
  render(
    <IpcProvider client={client}>
      <QueryClientProvider client={createQueryClient()}>
        <App router={router} />
      </QueryClientProvider>
    </IpcProvider>,
  );
  const review = mode === 'detailed' ? 'detailed' : 'step';
  await act(() => router.navigate(`/session/${SESSION}/${review}?step=s4`));
  expect(await screen.findByText(/^Step 4 (of|\/) 8$/)).toBeInTheDocument();
  await act(() => router.navigate(`/session/${SESSION}/summary`));
  return { client, router };
}

const itemOf = (message: HTMLElement, body: string): HTMLElement => {
  const item = message.closest('li');
  if (!item) throw new Error(`The message "${body}" is not in a list item.`);
  return item;
};

/** The list item of the thread whose first message is `body`, once the list has it. */
export async function rowOf(body: string): Promise<HTMLElement> {
  return itemOf(await screen.findByText(body), body);
}

/** The same, as the list is now (for `waitFor`); throws when the message is not shown. */
export const rowNow = (body: string): HTMLElement => itemOf(screen.getByText(body), body);

/** The row's button by its exact name. */
export const rowButton = (row: HTMLElement, name: string) =>
  within(row).getByRole('button', { name });

/** Waits until the Thread filter's buttons read `labels`, in order. */
export async function expectFilters(labels: string[]) {
  const group = await screen.findByRole('group', { name: 'Thread filter' });
  await waitFor(() => {
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(labels);
  });
}
