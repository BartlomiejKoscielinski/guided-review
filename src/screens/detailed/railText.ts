import type { ChangeStats } from '../../ipc/types/ChangeStats';
import type { Draft } from '../../ipc/types/Draft';
import type { Layer } from '../../ipc/types/Layer';
import type { StepOrder } from '../../ipc/types/StepOrder';
import { filesLabel, LAYER_LABEL, plural } from '../plan/planText';

/** The rail head's order name (Main.dc.html "contract → UI"); after a drag "your order". */
export function orderCaption(order: StepOrder): string {
  if (order.custom) return 'your order';
  switch (order.strategy) {
    case 'contractToUi':
      return 'contract → UI';
    case 'testsFirst':
      return 'tests first';
    case 'fileOrder':
      return 'file order';
  }
}

/** A step's size: `N files · +add −del`, without `−0` (the rail row, the end-of-step card). */
export function stepSize(stats: ChangeStats): string {
  const del = stats.deletions > 0 ? ` −${String(stats.deletions)}` : '';
  return `${filesLabel(stats)} · +${String(stats.additions)}${del}`;
}

/** A step row's second line: `layer · N files · +add −del`, without `−0`. */
export function stepMeta(layer: Layer, stats: ChangeStats): string {
  return `${LAYER_LABEL[layer]} · ${stepSize(stats)}`;
}

/** What a step row shows at its end. */
export type RowEnd =
  { kind: 'notes'; label: string } | { kind: 'drafts'; count: number; title: string } | null;

/**
 * The end of a step row: the current step's open notes ("4 notes") while it has any, else the
 * step's drafts not on GitLab yet as a count ("2", titled "2 drafts"), else nothing.
 */
export function rowEnd(current: boolean, openNotes: number | undefined, drafts: number): RowEnd {
  if (current && openNotes !== undefined && openNotes > 0) {
    return { kind: 'notes', label: plural(openNotes, 'note') };
  }
  if (drafts > 0) return { kind: 'drafts', count: drafts, title: plural(drafts, 'draft') };
  return null;
}

/** The drafts a step row counts: the step's drafts not on GitLab yet, as the header's "Drafts N". */
export const stepDrafts = (drafts: readonly Draft[], stepId: string): number =>
  drafts.filter((d) => d.stepId === stepId && d.publishedNoteId === null).length;
