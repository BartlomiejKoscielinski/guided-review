import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pathFor } from '../../app/routes';
import { IpcError } from '../../ipc/errors';
import type { AnalysisStatus } from '../../ipc/types/AnalysisStatus';
import { useFocusStore } from '../../state/focus';
import { renderApp } from '../../test/renderApp';

// F-08.8 decision (autopilot): Claude Code's status words come from the Claude Code check, not
// from the analysis status, so the footer shows them even when the analysis status can't be read.

const SESSION = 'mock-mr-session-1';

describe('S-04 footer with Claude Code unusable (F-08.8)', () => {
  beforeEach(() => {
    useFocusStore.setState({ layout: 'A' });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800);
  });

  it('F-08.8 Claude Code not signed in shows its words when the analysis status cannot be read', async () => {
    const reviewAnalysisStatus = vi.fn<() => Promise<AnalysisStatus>>(() =>
      Promise.reject(
        new IpcError({ code: 'INVALID_INPUT', message: 'No such session.', retryable: false }),
      ),
    );
    const app = renderApp(
      { screen: 'S-04', sessionId: SESSION },
      { claudeStatus: () => Promise.resolve({ state: 'notSignedIn' }), reviewAnalysisStatus },
    );
    await app.router.navigate(`${pathFor({ screen: 'S-04', sessionId: SESSION })}?step=s4`);
    await screen.findByTestId('info-header');
    await waitFor(() => {
      expect(reviewAnalysisStatus).toHaveBeenCalled();
    });
    const footer = document.querySelector('footer');
    if (!(footer instanceof HTMLElement)) throw new Error('S-04 has no <footer>');
    await waitFor(() => {
      expect(
        Array.from(footer.querySelectorAll('span')).some(
          (el) => el.textContent === 'Claude Code: not signed in',
        ),
      ).toBe(true);
    });
    expect(footer.textContent).not.toMatch(/@|working tree|Claude: /);
  });
});
