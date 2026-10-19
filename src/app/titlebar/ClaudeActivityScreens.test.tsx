import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { routeFor, type ScreenId } from '../routes';
import { mockClient } from '../../test/render';
import { renderApp } from '../../test/renderApp';

const bar = () => within(screen.getByTestId('title-bar'));
const RUNNING = { claude: { activity: { running: 1, waiting: 2 } } };
const LABEL = 'Claude is working: 1 running, 2 waiting.';

function renderOn(screenId: ScreenId) {
  const route = routeFor(screenId, { sessionId: 'mock-mr-session-1', iid: '6' });
  if (!route) throw new Error(`no route for ${screenId}`);
  return renderApp(route, mockClient({}, RUNNING));
}

/** The spinner and the screen's model chip (its title names the model and effort). */
async function spinnerRightOfModelChip() {
  const spinner = await bar().findByRole('status', { name: LABEL });
  const chip = bar()
    .getAllByRole('button')
    .find((b) => b.getAttribute('title')?.startsWith('Claude model and effort'));
  expect(chip).toBeDefined();
  // DOCUMENT_POSITION_FOLLOWING: the spinner comes after (right of) the model chip.
  expect(chip?.compareDocumentPosition(spinner) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(spinner.previousElementSibling).toBe(chip);
}

describe('Claude activity spinner on the screens that run Claude', () => {
  it.each<ScreenId>(['S-03', 'S-04', 'S-02', 'S-05', 'S-06', 'S-08', 'S-09', 'S-10', 'S-11'])(
    'F-18.8 %s shows the spinner right of the model chip while a task runs',
    async (screenId) => {
      renderOn(screenId);
      await spinnerRightOfModelChip();
    },
  );

  it('F-18.8 S-03 shows no spinner while the queue is empty', async () => {
    renderApp({ screen: 'S-03', sessionId: 'mock-mr-session-1' }, mockClient({}, {}));
    await waitFor(() => {
      expect(
        bar()
          .getAllByRole('button')
          .some((b) => b.getAttribute('title')?.startsWith('Claude model and effort')),
      ).toBe(true);
    });
    expect(bar().queryByRole('status', { name: /Claude is working/ })).toBeNull();
  });
});
