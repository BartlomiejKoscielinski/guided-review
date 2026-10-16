import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import { createMockClient, type MockOptions } from '../../ipc/mock';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// F-08.7: the Guide aside's keys after a tick in "For you to judge". A click on a checkbox (or
// its label) leaves the focus on the checkbox, where a letter types nothing: `N` still cycles the
// Code notes and `A` still goes to the Ask box.

const SESSION = 'mock-mr-session-1';
const SECOND = 'PendingCount won’t refresh after upload';
const THIRD = 'Status texts are hardcoded';
const CHECK = 'Matches the MR description: the photo is saved even without network';

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

/** S-04 on !482's step 4 (four notes, three checks), its plan prepared as S-02 does. */
async function openStep4() {
  const ipc = createMockClient({ latencyMs: 0, storage: memoryStorage() });
  await ipc.repoPick();
  await ipc.reviewPlan(SESSION, () => undefined);
  const app = renderApp({ screen: 'S-04', sessionId: SESSION }, ipc);
  await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId: SESSION })}?step=s4`);
  await screen.findByRole('heading', { level: 1 });
}

const guide = () => within(screen.getByRole('complementary', { name: 'Guide' }));

/** The Code notes row holding `title` is the marked one. */
async function expectFocused(title: string) {
  await waitFor(() => {
    const notes = within(guide().getByRole('region', { name: 'Code notes' }));
    const row = notes.getByRole('button', { name: (name) => name.includes(title) });
    expect(row).toHaveAttribute('aria-pressed', 'true');
  });
}

/** Ticks the first check by clicking `what` and checks the focus stayed on its checkbox. */
async function tick(what: 'box' | 'label') {
  const judge = within(await guide().findByRole('region', { name: 'For you to judge' }));
  const box = judge.getByRole('checkbox', { name: CHECK });
  await userEvent.click(what === 'box' ? box : judge.getByText(CHECK, { exact: true }));
  await waitFor(() => {
    expect(box).toBeChecked();
  });
  expect(box).toHaveFocus();
}

describe('S-04 Guide aside keys after a tick (F-08.7)', () => {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    // jsdom lays nothing out: a measured diff row is one line high and the column is tall, so
    // step 4's lines render, as in GuideAside.test.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.hasAttribute('data-index') ? 22 : 4000;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('F-08.7 after a tick on a checkbox N moves the focus to the next note', async () => {
    await openStep4();
    await expectFocused(SECOND);
    await tick('box');
    await userEvent.keyboard('n');
    await expectFocused(THIRD);
  });

  it('F-08.7 after a tick on a check’s label N moves the focus to the next note', async () => {
    await openStep4();
    await expectFocused(SECOND);
    await tick('label');
    await userEvent.keyboard('n');
    await expectFocused(THIRD);
  });

  it('F-08.7 after a tick A focuses the Ask box', async () => {
    await openStep4();
    await tick('box');
    await userEvent.keyboard('a');
    const ask = guide().getByRole('textbox', { name: 'Ask about this step or the selected code' });
    expect(ask).toHaveFocus();
    expect(ask).toHaveValue('');
  });
});
