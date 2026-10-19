import { StatusChip } from '../../components/StatusChip';
import { Tag } from '../../components/Tag';
import type { ScreenId } from '../routes';
import { ActiveRepoSwitcher } from './ActiveRepoSwitcher';
import { BranchBlock } from './BranchBlock';
import { ClaudeActivity } from './ClaudeActivity';
import { ClaudeStatusChip } from './ClaudeStatusChip';
import { ChangesContext } from './ChangesContext';
import { ContextText } from './ContextText';
import { GitlabStatusControl } from './GitlabStatusControl';
import { PipelineContext } from './PipelineContext';
import { PlanContext } from './PlanContext';
import { PlanStatus } from './PlanStatus';
import { PLACEHOLDER } from './placeholders';
import { ReviewContext } from './ReviewContext';
import { SessionContext } from './StepControls';
import { StepTitleBar } from './StepTitleBar';
import { SettingsContext } from './SettingsContext';
import { TaskModelChip } from './TaskModelChip';
import { TitleBar } from './TitleBar';

const P = PLACEHOLDER;
export interface ScreenTitleBarProps {
  screen: ScreenId;
}

/** The title bar with each screen's context and controls (docs/02 › Shell table). */
export function ScreenTitleBar({ screen }: ScreenTitleBarProps) {
  switch (screen) {
    case 'S-01':
      return (
        <TitleBar
          context={<ActiveRepoSwitcher />}
          wideControls
          controls={
            <>
              <GitlabStatusControl />
              <ClaudeStatusChip />
              <ClaudeActivity />
            </>
          }
        />
      );
    case 'S-02':
      return (
        <TitleBar
          context={<PlanContext />}
          controls={
            <>
              <PlanStatus />
              <TaskModelChip group="plan" />
            </>
          }
        />
      );
    case 'S-03':
      return <StepTitleBar />;
    case 'S-04':
      return <StepTitleBar mode="detailed" />;
    case 'S-05':
      return <TitleBar context={<ReviewContext />} controls={<TaskModelChip group="mr" />} />;
    case 'S-06':
      return <TitleBar context={<ChangesContext />} controls={<TaskModelChip group="commit" />} />;
    case 'S-07':
      return <TitleBar context={<SettingsContext />} />;
    case 'S-08':
      return <TitleBar context={<PipelineContext />} controls={<TaskModelChip group="mr" />} />;
    case 'S-09':
      return (
        <TitleBar
          context={<SessionContext iid={P.rereviewMr.iid} title={P.rereviewMr.title} />}
          controls={<TaskModelChip group="step" />}
        />
      );
    case 'S-10':
      return (
        <TitleBar
          context={
            <>
              <ContextText kind="repo">{P.repo.name}</ContextText>
              <ContextText kind="iid" mine>
                {P.authorMr.iid}
              </ContextText>
              <ContextText kind="title">{P.authorMr.title}</ContextText>
              <Tag color="blue">You’re the author</Tag>
            </>
          }
          controls={
            <>
              <StatusChip color="green" label={P.pipelineStatus} />
              {<TaskModelChip group="fix" />}
            </>
          }
        />
      );
    case 'S-11':
      return (
        <TitleBar
          context={
            <>
              <ContextText kind="repo">{P.repo.name}</ContextText>
              <BranchBlock branch={P.branch} />
              <ContextText kind="title">New merge request</ContextText>
            </>
          }
          controls={<TaskModelChip group="mr" />}
        />
      );
  }
}
