import type { ClaudeSettings } from '../../ipc/types/ClaudeSettings';
import type { ClaudeTasks } from '../../ipc/types/ClaudeTasks';
import type { Effort } from '../../ipc/types/Effort';
import type { ModelInfo } from '../../ipc/types/ModelInfo';

/** Override groups of F-18.3 (settings keys). */
export type TaskGroup = keyof ClaudeTasks;

/** The model ID and effort a task group runs with ("default" follows the global value). */
export function taskModel(
  settings: ClaudeSettings,
  group: TaskGroup,
): { model: string | null; effort: Effort } {
  const task = settings.tasks[group];
  const model =
    task.model === 'default' ? (settings.model === 'inherit' ? null : settings.model) : task.model;
  const effort = task.effort === 'default' ? settings.effort : task.effort;
  return { model, effort };
}

/** A model ID's label, the ID itself for unknown models. */
export function modelName(models: readonly ModelInfo[], id: string): string {
  return models.find((m) => m.id === id)?.label ?? id;
}

/**
 * The title-bar chip text (F-18.5): "Haiku 5.5 · low"; "Same as Claude Code" reads
 * "Claude Code default · low" (02 › S-07).
 */
export function chipLabel(
  settings: ClaudeSettings,
  group: TaskGroup,
  models: readonly ModelInfo[],
): string {
  const { model, effort } = taskModel(settings, group);
  return `${model === null ? 'Claude Code default' : modelName(models, model)} · ${effort}`;
}
