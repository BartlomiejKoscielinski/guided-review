import type { Effort } from '../../ipc/types/Effort';
import type { ModelInfo } from '../../ipc/types/ModelInfo';

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * F-18.4: why an effort can't be picked for a model ("<Model> doesn't support <effort>."), or
 * null. "Same as Claude Code" (null model) allows all levels (docs/05 › Models).
 */
export function unsupported(
  models: readonly ModelInfo[],
  modelId: string | null,
  effort: Effort,
): string | null {
  if (modelId === null) return null;
  const model = models.find((m) => m.id === modelId);
  if (!model || model.efforts.includes(effort)) return null;
  return `${model.label} doesn't support ${effort}.`;
}
