import { createContext, useContext } from 'react';
import type { ScreenId } from './routes';

/** The screen shown before the current one in this window; null on the first screen. */
export const PreviousScreenContext = createContext<ScreenId | null>(null);

export function usePreviousScreen(): ScreenId | null {
  return useContext(PreviousScreenContext);
}
