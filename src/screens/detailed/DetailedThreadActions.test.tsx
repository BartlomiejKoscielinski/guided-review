import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { createMockClient } from '../../ipc/mock';
import { useDetailedStore } from '../../state/detailed';
import { renderApp } from '../../test/renderApp';

// F-11.2 on S-04 (M5 decision 3: the same thread cards as in Focus): Resolve, Reopen and Reply
// work on a card in Detailed mode and go to GitLab at once.

const SESSION = 'mock-mr-session-1';
const KICK = 'd-482-3';

async function backend() {
  const ipc = createMockClient({ latencyMs: 0 });
  await ipc.repoPick();
  await ipc.reviewPlan(SESSION, () => undefined);
  return ipc;
}

/** S-04 on step 4 (the thread at `_worker.Kick()`, line 48). */
async function openDetailed(client: Partial<IpcClient>) {
  const app = renderApp({ screen: 'S-04', sessionId: SESSION }, client);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId: SESSION })}?step=s4`);
  await screen.findByRole('heading', { level: 1 });
  return app;
}

const thread = () => screen.getByRole('region', { name: 'Thread at line 48' });
const button = (name: string, scope?: HTMLElement) =>
  (scope ? within(scope) : screen).getByRole('button', { name });

describe('S-04 thread actions (F-11.2)', () => {
  beforeEach(() => {
    useDetailedStore.setState({ layout: 'split' });
    // jsdom lays nothing out; a measured diff row is one line high and the column is tall, so
    // all of step 4's lines render.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-11.2 in Detailed mode Resolve turns the card into Resolved with Reopen, and Reopen brings it back', async () => {
    const ipc = await backend();
    const resolveCall = vi.spyOn(ipc, 'gitlabResolve');
    await openDetailed(ipc);
    await screen.findByRole('region', { name: 'Thread at line 48' });

    await userEvent.click(button('Resolve', thread()));
    await within(thread()).findByRole('button', { name: 'Reopen' });
    expect(resolveCall).toHaveBeenLastCalledWith(SESSION, KICK, true);
    expect(within(thread()).getByText('Resolved')).toBeInTheDocument();
    expect(within(thread()).queryByRole('button', { name: 'Reply' })).toBeNull();
    expect(
      await screen.findByRole('button', { name: 'Thread by Paweł S. at line 48, resolved' }),
    ).toBeInTheDocument();

    await userEvent.click(button('Reopen', thread()));
    await within(thread()).findByRole('button', { name: 'Resolve' });
    expect(resolveCall).toHaveBeenLastCalledWith(SESSION, KICK, false);
    expect(within(thread()).queryByText('Resolved')).toBeNull();
    expect(button('Reply', thread())).toBeInTheDocument();
  });

  it('F-11.2 in Detailed mode a reply is sent at once and appears under the notes', async () => {
    const ipc = await backend();
    const replyCall = vi.spyOn(ipc, 'gitlabReply');
    await openDetailed(ipc);
    await screen.findByRole('region', { name: 'Thread at line 48' });

    await userEvent.click(button('Reply', thread()));
    await userEvent.type(await screen.findByPlaceholderText('Write a reply…'), 'Agreed.');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');

    expect(await within(thread()).findByText('Agreed.')).toBeInTheDocument();
    expect(replyCall).toHaveBeenCalledTimes(1);
    expect(replyCall).toHaveBeenCalledWith(SESSION, KICK, 'Agreed.');
    expect(await ipc.draftsList(SESSION)).toEqual([]);
    expect(within(thread()).getByText('Bartek K.', { selector: 'b' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Write a reply…')).toBeNull();
    });
  });
});
