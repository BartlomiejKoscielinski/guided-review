import { useCallback } from 'react';
import { useLocation, useMatches, useNavigate, useSearchParams } from 'react-router';
import { useSessionState, useSessionStateWriter } from '../ipc/hooks/useSessionState';
import type { Mode } from '../ipc/types/Mode';
import { pathFor, stepScreen } from './routes';

export interface ModeSwitch {
  /** The mode on screen: S-03 Focus, S-04 Detailed. */
  mode: Mode;
  /** Opens step review in `mode` on the same step. */
  set: (mode: Mode) => void;
  /** `Ctrl+D`: the other mode. */
  toggle: () => void;
}

function screenOf(handle: unknown): unknown {
  return typeof handle === 'object' && handle !== null && 'screen' in handle
    ? handle.screen
    : undefined;
}

/**
 * The Focus | Detailed switch of step review (F-08.1, ADR-010), `null` outside S-03 and S-04. The
 * other screen opens on the same step (`?step=`, else the step the session is on) with the same
 * location state, so a restored start stays one (F-30.4). The switch is the session's mode, which
 * Continue, resume and Start step 1 open; Settings › General › Start in is the mode of new
 * sessions and is left alone (M4 decision 4).
 */
export function useModeSwitch(): ModeSwitch | null {
  const match = useMatches().at(-1);
  const screen = screenOf(match?.handle);
  const sessionId = match?.params.sessionId ?? '';
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const writer = useSessionStateWriter(sessionId);
  const kept = useSessionState(sessionId).data?.currentStep ?? null;
  const onReview = (screen === 'S-03' || screen === 'S-04') && sessionId !== '';
  const mode: Mode = screen === 'S-04' ? 'detailed' : 'focus';
  const step = params.get('step') ?? kept;
  const state: unknown = location.state;

  const set = useCallback(
    (next: Mode) => {
      if (!onReview || next === mode) return;
      writer.setMode(next);
      const path = pathFor({ screen: stepScreen(next), sessionId });
      const search = step === null || step === '' ? '' : `?step=${encodeURIComponent(step)}`;
      void navigate(`${path}${search}`, { state });
    },
    [mode, navigate, onReview, sessionId, state, step, writer],
  );
  const toggle = useCallback(() => {
    set(mode === 'focus' ? 'detailed' : 'focus');
  }, [mode, set]);

  return onReview ? { mode, set, toggle } : null;
}
