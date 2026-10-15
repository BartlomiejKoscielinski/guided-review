import type { ChangeStats } from '../../ipc/types/ChangeStats';
import type { Claim } from '../../ipc/types/Claim';
import type { Layer } from '../../ipc/types/Layer';
import type { Strategy } from '../../ipc/types/Strategy';

/** Layer tags (F-05.4): the plan and the UI use the same names. */
export const LAYER_LABEL: Record<Layer, string> = {
  core: 'Core',
  infrastructure: 'Infrastructure',
  app: 'App',
  xaml: 'XAML',
  platforms: 'Platforms',
  tests: 'Tests',
  resources: 'Resources',
  build: 'Build',
  other: 'Other',
};

export const STRATEGY_OPTIONS: readonly { value: Strategy; label: string }[] = [
  { value: 'contractToUi', label: 'Contract to UI' },
  { value: 'testsFirst', label: 'Tests first' },
  { value: 'fileOrder', label: 'File order' },
];

/** The caption under "Plan · N steps" (F-06.4, Overview.dc.html); `custom` after a drag (F-06.5). */
export function strategyCaption(strategy: Strategy, custom: boolean): string {
  if (custom) return 'Your order. Pick a strategy to reset it.';
  switch (strategy) {
    case 'contractToUi':
      return 'Contract to UI: start with what everything else builds on.';
    case 'testsFirst':
      return 'Tests first: read them as the spec, then the implementation.';
    case 'fileOrder':
      return 'File order, as in GitLab: the UI shows up before the contract it relies on.';
  }
}

export const plural = (n: number, word: string) => `${String(n)} ${n === 1 ? word : `${word}s`}`;

/** `2 files` of a row (F-06.3). */
export const filesLabel = (stats: ChangeStats) => plural(stats.files, 'file');

/** "Step 3" / "Steps 2, 4" by position in the reader's order; unknown IDs are left out. */
export function stepRefs(ids: readonly string[], position: (id: string) => number): string {
  const numbers = ids.map(position).filter((n) => n > 0);
  if (numbers.length === 0) return '';
  return `${numbers.length === 1 ? 'Step' : 'Steps'} ${numbers.join(', ')}`;
}

/**
 * A description claim (F-06.8): the quoted claim and where it is, or what the description
 * leaves out (Overview.dc.html).
 */
export function claimText(claim: Claim, step: number): { text: string; where: string } {
  const at = step > 0 ? String(step) : '';
  switch (claim.status) {
    case 'found':
      return { text: `“${claim.claim}”`, where: at ? `found in step ${at}` : 'found' };
    case 'missing':
      return { text: `“${claim.claim}”`, where: 'not found in the code' };
    case 'contradicted':
      return {
        text: `“${claim.claim}”`,
        where: at ? `contradicted in step ${at}` : 'contradicted by the code',
      };
    case 'notInDescription':
      return { text: `The description doesn't mention ${claim.claim}`, where: at && `step ${at}` };
  }
}
