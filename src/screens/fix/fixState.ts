import type { FixProposal } from '../../ipc/types/FixProposal';

/** What the fix card shows (F-25.3): Claude at work, its proposal, or why the run failed. */
export type FixCardState =
  | { phase: 'running'; file: string }
  | { phase: 'proposed'; proposal: FixProposal }
  | { phase: 'failed'; file: string; message: string };

/** The file's name without its folders ("src/A b/C.cs" → "C.cs"). */
export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
