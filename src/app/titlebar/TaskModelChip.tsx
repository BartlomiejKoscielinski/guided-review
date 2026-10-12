import { useNavigate } from 'react-router';
import { ModelChip } from '../../components/ModelChip';
import { useClaudeModels } from '../../ipc/hooks/useClaude';
import { useSettings } from '../../ipc/hooks/useSettings';
import { CLAUDE_SETTINGS_ROUTE, pathFor } from '../routes';
import { chipLabel, type TaskGroup } from './modelLabel';

export interface TaskModelChipProps {
  /** The task relevant to the screen (02 › Shell table). */
  group: TaskGroup;
}

/** Model · effort of the screen's task; opens Settings › Claude (F-18.5). */
export function TaskModelChip({ group }: TaskModelChipProps) {
  const navigate = useNavigate();
  const settings = useSettings();
  const models = useClaudeModels();
  if (!settings.data) return null;
  return (
    <ModelChip
      label={chipLabel(settings.data.claude, group, models.data ?? [])}
      onOpen={() => {
        void navigate(pathFor(CLAUDE_SETTINGS_ROUTE));
      }}
    />
  );
}
