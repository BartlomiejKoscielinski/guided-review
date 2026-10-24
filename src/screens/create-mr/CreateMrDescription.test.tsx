import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import type { IpcClient } from '../../ipc/client';
import { IpcError } from '../../ipc/errors';
import type { MrDescription } from '../../ipc/types/MrDescription';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';

// F-27.2 on S-11 (M7 decisions 15 and 16). Locators the screen keeps: textboxes labelled "Title"
// and "Description"; the regenerate slot is ONE button next to the Description label: "Write with
// Claude" first, "Writing…" (disabled) while the task runs, then "Shorter version" / "Longer
// version" (the one the next click does, as in CreateMR.dc.html); the text "Drafted by Claude
// from N commits and the diff" appears only once Claude has written (singular "1 commit"); the
// confirm is role="alertdialog" named "Replace your edits?" with buttons "Replace" and "Cancel"
// (focus on Cancel, Escape cancels, as the Run pipeline strip of S-08); a failed task shows its
// message in a role="alert". IPC: `gitMrTitle(target?)` and `claudeMrDescription(task, variant,
// target?)` with variant 'normal' | 'short' | 'long'.

const SKELETON = '## What\n\n## Why\n\n## How to test\n1. ';
const WRITTEN: MrDescription = {
  title: 'Enable compiled bindings in app pages',
  description:
    '## What\nAdds x:DataType to 12 pages.\n\n## Why\nCompiled bindings fail at build time.\n\n## How to test\n1. Build Release.\n2. Rotate the device.',
};
const SHORT: MrDescription = {
  title: 'Enable compiled bindings',
  description:
    '## What\nTurns on compiled bindings.\n\n## Why\nTypos break the build.\n\n## How to test\n1. Release build.',
};
const LONG: MrDescription = {
  title: 'Enable compiled bindings in all app pages',
  description:
    '## What\nTurns on compiled bindings (x:DataType) in all 12 app pages and their templates.\n\n## Why\nTypos in bindings now break the build.\n\n## How to test\n1. Release build on a device.\n2. Click through the pages.\n3. Rotate the device.',
};

/** Each call answers with the next result (the last one repeats). */
function answers(...results: MrDescription[]) {
  let n = 0;
  return vi.fn<IpcClient['claudeMrDescription']>(() => {
    const next = results[Math.min(n, results.length - 1)];
    n += 1;
    return Promise.resolve(next ?? WRITTEN);
  });
}

function show(client: Partial<IpcClient> = {}) {
  return renderApp({ screen: 'S-11' }, client);
}

const titleBox = () => screen.findByRole('textbox', { name: 'Title' });
const descriptionBox = () => screen.findByRole('textbox', { name: 'Description' });
const button = (name: string) => screen.getByRole('button', { name });

async function ready() {
  const title = await titleBox();
  await waitFor(() => {
    expect(title).not.toHaveValue('');
  });
  return { title, description: await descriptionBox() };
}

/** Write with Claude once, so the slot reads Shorter version. */
async function written(user: ReturnType<typeof userEvent.setup>) {
  const fields = await ready();
  await user.click(button('Write with Claude'));
  await screen.findByRole('button', { name: 'Shorter version' });
  return fields;
}

describe('S-11 title and description (F-27.2)', () => {
  it('F-27.2 opens with the title from the commits and the empty What / Why / How to test skeleton, and starts no Claude run', async () => {
    const claudeMrDescription = answers(WRITTEN);
    show({ claudeMrDescription });
    const { title, description } = await ready();
    expect(title).toHaveValue('Chore compiled bindings');
    expect(description).toHaveValue(SKELETON);
    expect(button('Write with Claude')).toBeEnabled();
    expect(screen.queryByRole('button', { name: /^(Shorter|Longer) version$/ })).toBeNull();
    expect(screen.queryByText(/Drafted by Claude/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(claudeMrDescription).not.toHaveBeenCalled();
  });

  it('F-27.2 the title is what the core read from the commits (a single commit: its subject)', async () => {
    const gitMrTitle = vi.fn<IpcClient['gitMrTitle']>(() =>
      Promise.resolve('Fix the scanner crash'),
    );
    show({ gitMrTitle });
    expect(await screen.findByDisplayValue('Fix the scanner crash')).toBe(await titleBox());
    expect(gitMrTitle).toHaveBeenCalled();
  });

  it('F-27.2 when the title cannot be read it stays empty and editable, without an alert', async () => {
    const gitMrTitle = vi.fn<IpcClient['gitMrTitle']>(() =>
      Promise.reject(
        new IpcError({ code: 'INVALID_INPUT', message: 'No commits.', retryable: false }),
      ),
    );
    show({ gitMrTitle });
    const title = await titleBox();
    await waitFor(() => {
      expect(gitMrTitle).toHaveBeenCalled();
    });
    expect(title).toHaveValue('');
    expect(screen.queryByRole('alert')).toBeNull();
    await userEvent.type(title, 'Mine');
    expect(title).toHaveValue('Mine');
  });

  it('F-27.2 Write with Claude asks once, shows Writing… while it runs, then fills the title and the description and labels the field', async () => {
    const user = userEvent.setup();
    let release: (result: MrDescription) => void = () => undefined;
    const claudeMrDescription = vi.fn<IpcClient['claudeMrDescription']>(
      () =>
        new Promise<MrDescription>((resolve) => {
          release = resolve;
        }),
    );
    show({ claudeMrDescription });
    const { title, description } = await ready();
    await user.click(button('Write with Claude'));
    const busy = button('Writing…');
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(claudeMrDescription).toHaveBeenCalledTimes(1);
    expect(claudeMrDescription.mock.calls[0]?.[1]).toBe('normal');
    expect(screen.queryByText(/Drafted by Claude/)).toBeNull();

    act(() => {
      release(WRITTEN);
    });
    expect(await screen.findByRole('button', { name: 'Shorter version' })).toBeEnabled();
    expect(title).toHaveValue(WRITTEN.title);
    expect(description).toHaveValue(WRITTEN.description);
    expect(screen.getByText('Drafted by Claude from 3 commits and the diff')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write with Claude' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Writing…' })).toBeNull();
  });

  it('F-27.2 the label says "1 commit" in the singular', async () => {
    const user = userEvent.setup();
    const base = mockClient();
    const gitBranchInfo = vi.fn<IpcClient['gitBranchInfo']>((target) =>
      base.gitBranchInfo(target).then((info) => ({ ...info, commits: 1 })),
    );
    show({ gitBranchInfo, claudeMrDescription: answers(WRITTEN) });
    await ready();
    await user.click(button('Write with Claude'));
    expect(
      await screen.findByText('Drafted by Claude from 1 commit and the diff'),
    ).toBeInTheDocument();
  });

  it('F-27.2 the description is written for the target chosen in the branch block', async () => {
    const user = userEvent.setup();
    const claudeMrDescription = answers(WRITTEN);
    show({ claudeMrDescription });
    await ready();
    const target = await screen.findByRole('combobox', { name: 'Target branch' });
    await user.selectOptions(target, 'main');
    await user.click(button('Write with Claude'));
    await screen.findByRole('button', { name: 'Shorter version' });
    expect(claudeMrDescription.mock.calls[0]?.[2]).toBe('main');
  });

  it('F-27.2 Shorter version and Longer version regenerate; the slot offers the other one next', async () => {
    const user = userEvent.setup();
    const claudeMrDescription = answers(WRITTEN, SHORT, LONG);
    show({ claudeMrDescription });
    const { title, description } = await written(user);

    await user.click(button('Shorter version'));
    expect(await screen.findByRole('button', { name: 'Longer version' })).toBeEnabled();
    expect(claudeMrDescription.mock.calls.map((c) => c[1])).toEqual(['normal', 'short']);
    expect(title).toHaveValue(SHORT.title);
    expect(description).toHaveValue(SHORT.description);

    await user.click(button('Longer version'));
    expect(await screen.findByRole('button', { name: 'Shorter version' })).toBeEnabled();
    expect(claudeMrDescription.mock.calls.map((c) => c[1])).toEqual(['normal', 'short', 'long']);
    expect(title).toHaveValue(LONG.title);
    expect(description).toHaveValue(LONG.description);
    expect(screen.getByText('Drafted by Claude from 3 commits and the diff')).toBeInTheDocument();
  });

  it('F-27.2 while a regeneration runs the slot reads Writing… and the text stays until the answer', async () => {
    const user = userEvent.setup();
    let release: (result: MrDescription) => void = () => undefined;
    let calls = 0;
    const claudeMrDescription = vi.fn<IpcClient['claudeMrDescription']>(() => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(WRITTEN)
        : new Promise<MrDescription>((resolve) => {
            release = resolve;
          });
    });
    show({ claudeMrDescription });
    const { description } = await written(user);
    await user.click(button('Shorter version'));
    expect(button('Writing…')).toBeDisabled();
    expect(description).toHaveValue(WRITTEN.description);
    act(() => {
      release(SHORT);
    });
    expect(await screen.findByRole('button', { name: 'Longer version' })).toBeInTheDocument();
    expect(description).toHaveValue(SHORT.description);
  });

  it('F-27.2 a failed run shows its message, leaves the text and the slot as they were', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const claudeMrDescription = vi.fn<IpcClient['claudeMrDescription']>(() => {
      calls += 1;
      return calls === 2
        ? Promise.resolve(WRITTEN)
        : Promise.reject(
            new IpcError({
              code: 'CLAUDE_LIMITED',
              message: 'Claude usage limit reached',
              retryable: true,
            }),
          );
    });
    show({ claudeMrDescription });
    const { title, description } = await ready();

    // First Write fails: the skeleton and the title stay, the slot is Write with Claude again.
    await user.click(button('Write with Claude'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Claude usage limit reached');
    expect(button('Write with Claude')).toBeEnabled();
    expect(title).toHaveValue('Chore compiled bindings');
    expect(description).toHaveValue(SKELETON);
    expect(screen.queryByText(/Drafted by Claude/)).toBeNull();

    // The retry works and the alert is gone; a later failure keeps the written text and Shorter.
    await user.click(button('Write with Claude'));
    await screen.findByRole('button', { name: 'Shorter version' });
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(button('Shorter version'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Claude usage limit reached');
    expect(button('Shorter version')).toBeEnabled();
    expect(description).toHaveValue(WRITTEN.description);
    expect(title).toHaveValue(WRITTEN.title);
  });
});

describe('S-11 regenerating over edits (F-27.2, M7 decision 16)', () => {
  it.each(['title', 'description'] as const)(
    'F-27.2 Write with Claude asks "Replace your edits?" first when you edited the %s; Cancel keeps your text and runs nothing',
    async (field) => {
      const user = userEvent.setup();
      const claudeMrDescription = answers(WRITTEN);
      show({ claudeMrDescription });
      const boxes = await ready();
      await user.type(boxes[field], ' mine');
      const typed = (boxes[field] as HTMLInputElement | HTMLTextAreaElement).value;

      await user.click(button('Write with Claude'));
      const dialog = screen.getByRole('alertdialog', { name: 'Replace your edits?' });
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
      expect(within(dialog).getByRole('button', { name: 'Replace' })).toBeEnabled();
      expect(claudeMrDescription).not.toHaveBeenCalled();

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(boxes[field]).toHaveValue(typed);
      expect(claudeMrDescription).not.toHaveBeenCalled();
      expect(button('Write with Claude')).toBeEnabled();
    },
  );

  it('F-27.2 Replace runs the task and the result replaces both fields', async () => {
    const user = userEvent.setup();
    const claudeMrDescription = answers(WRITTEN);
    show({ claudeMrDescription });
    const { title, description } = await ready();
    await user.type(title, ' mine');
    await user.click(button('Write with Claude'));
    await user.click(
      within(screen.getByRole('alertdialog', { name: 'Replace your edits?' })).getByRole('button', {
        name: 'Replace',
      }),
    );
    expect(await screen.findByRole('button', { name: 'Shorter version' })).toBeInTheDocument();
    expect(claudeMrDescription).toHaveBeenCalledTimes(1);
    expect(claudeMrDescription.mock.calls[0]?.[1]).toBe('normal');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(title).toHaveValue(WRITTEN.title);
    expect(description).toHaveValue(WRITTEN.description);
  });

  it('F-27.2 Escape in the question cancels it like Cancel', async () => {
    const user = userEvent.setup();
    const claudeMrDescription = answers(WRITTEN);
    show({ claudeMrDescription });
    const { description } = await ready();
    await user.type(description, 'x');
    await user.click(button('Write with Claude'));
    screen.getByRole('alertdialog', { name: 'Replace your edits?' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(claudeMrDescription).not.toHaveBeenCalled();
  });

  it('F-27.2 Shorter version over untouched Claude text asks nothing; over your edit it asks and passes the variant on Replace', async () => {
    const user = userEvent.setup();
    const claudeMrDescription = answers(WRITTEN, SHORT, LONG);
    show({ claudeMrDescription });
    const { description } = await written(user);

    await user.click(button('Shorter version'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await screen.findByRole('button', { name: 'Longer version' });

    await user.type(description, ' and my own line');
    await user.click(button('Longer version'));
    const dialog = screen.getByRole('alertdialog', { name: 'Replace your edits?' });
    expect(claudeMrDescription).toHaveBeenCalledTimes(2);
    await user.click(within(dialog).getByRole('button', { name: 'Replace' }));
    await screen.findByRole('button', { name: 'Shorter version' });
    expect(claudeMrDescription.mock.calls.map((c) => c[1])).toEqual(['normal', 'short', 'long']);
    expect(description).toHaveValue(LONG.description);

    // The text is Claude's again: the next regeneration asks nothing.
    await user.click(button('Shorter version'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('S-11 opened by Draft MR description (F-27.2, M7 decision 15)', () => {
  async function openFromSelfReview(claudeMrDescription: IpcClient['claudeMrDescription']) {
    const { router } = renderApp({ screen: 'S-06' }, { claudeMrDescription });
    await act(async () => {
      await router.navigate(pathFor({ screen: 'S-11' }), { state: { draftDescription: true } });
    });
  }

  it('F-27.2 that click starts the task once: Writing…, then the written title and description', async () => {
    let release: (result: MrDescription) => void = () => undefined;
    const claudeMrDescription = vi.fn<IpcClient['claudeMrDescription']>(
      () =>
        new Promise<MrDescription>((resolve) => {
          release = resolve;
        }),
    );
    await openFromSelfReview(claudeMrDescription);
    expect(await screen.findByRole('button', { name: 'Writing…' })).toBeDisabled();
    expect(claudeMrDescription).toHaveBeenCalledTimes(1);
    expect(claudeMrDescription.mock.calls[0]?.[1]).toBe('normal');
    act(() => {
      release(WRITTEN);
    });
    expect(await screen.findByRole('button', { name: 'Shorter version' })).toBeInTheDocument();
    expect(await titleBox()).toHaveValue(WRITTEN.title);
    expect(await descriptionBox()).toHaveValue(WRITTEN.description);
    expect(screen.getByText('Drafted by Claude from 3 commits and the diff')).toBeInTheDocument();
    expect(claudeMrDescription).toHaveBeenCalledTimes(1);
  });

  it('F-27.2 opened any other way (Push and create MR) it starts nothing', async () => {
    const claudeMrDescription = answers(WRITTEN);
    const { router } = renderApp({ screen: 'S-06' }, { claudeMrDescription });
    await act(async () => {
      await router.navigate(pathFor({ screen: 'S-11' }));
    });
    expect(await screen.findByRole('button', { name: 'Write with Claude' })).toBeEnabled();
    expect(claudeMrDescription).not.toHaveBeenCalled();
  });
});
