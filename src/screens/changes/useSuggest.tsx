import type { ReactNode } from 'react';

export interface Suggest {
  pending: boolean;
  run: () => void;
  notice: ReactNode;
}

/** Suggest (F-16.4): Claude writes a commit message from the staged diff (wired with M1 Claude). */
export function useSuggest(): Suggest {
  return { pending: false, run: () => undefined, notice: null };
}
