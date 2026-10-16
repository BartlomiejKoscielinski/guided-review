import type { LineSelection } from '../../ipc/types/LineSelection';

/**
 * The Ask box's context (M4 decision 7): "step 4" about the whole step, "step 4 · L46–L57" with
 * selected lines ("step 4 · L49" for one), "(old)" after lines of the old side.
 */
export function askContextLabel(stepNumber: number, selection: LineSelection | null): string {
  const step = `step ${String(stepNumber)}`;
  if (selection === null) return step;
  const low = Math.min(selection.start, selection.end);
  const high = Math.max(selection.start, selection.end);
  const lines = low === high ? `L${String(low)}` : `L${String(low)}–L${String(high)}`;
  return `${step} · ${lines}${selection.side === 'old' ? ' (old)' : ''}`;
}
