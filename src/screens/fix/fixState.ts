import type { FixProposal } from '../../ipc/types/FixProposal';

/**
 * What the fix card shows (F-25.3, F-25.4): Claude at work, its proposal (`accepting` while
 * Accept writes, `error` after a refused Accept), why the run failed, or the accepted change.
 */
export type FixCardState =
  | { phase: 'running'; file: string }
  | { phase: 'proposed'; proposal: FixProposal; accepting?: boolean; error?: string }
  | { phase: 'failed'; file: string; message: string }
  | { phase: 'applied' };

/** The file's name without its folders ("src/A b/C.cs" → "C.cs"). */
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
