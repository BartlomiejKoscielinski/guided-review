import { useEffect } from 'react';
import { useSettings } from '../ipc/hooks/useSettings';

/**
 * Applies Settings › General › Diff colors (`ui.diffColors`, F-19.1) as `data-diff` on the root
 * element, on start and whenever it changes; tokens.css swaps the diff palette for "green-red".
 */
export function useDiffColors(): void {
  const colors = useSettings().data?.ui.diffColors;
  useEffect(() => {
    if (colors) document.documentElement.setAttribute('data-diff', colors);
  }, [colors]);
}
