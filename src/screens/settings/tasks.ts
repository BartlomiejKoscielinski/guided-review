import type { BlockColor } from '../../components/colors';
import type { TaskGroup } from '../../app/titlebar/modelLabel';

export interface TaskInfo {
  group: TaskGroup;
  label: string;
  hint: string;
  color: BlockColor;
}

/** The six override groups of F-18.3, as in Settings.dc.html. */
export const TASKS: readonly TaskInfo[] = [
  {
    group: 'plan',
    label: 'Review plan',
    hint: 'Once per MR: step order and risks',
    color: 'yellow',
  },
  {
    group: 'step',
    label: 'Step analysis',
    hint: 'For every step, runs in the background',
    color: 'orange',
  },
  { group: 'ask', label: 'Questions', hint: 'On demand, in the same session', color: 'blue' },
  {
    group: 'fix',
    label: 'Fixes on your code',
    hint: 'Fix with Claude, edits one file',
    color: 'purple',
  },
  {
    group: 'mr',
    label: 'MR description and pipeline',
    hint: 'New MR text, explaining failed jobs',
    color: 'white',
  },
  { group: 'commit', label: 'Commit message', hint: 'When you click Suggest', color: 'green' },
];
