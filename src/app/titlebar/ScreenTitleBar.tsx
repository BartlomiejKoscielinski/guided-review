import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../../components/Button';
import { LayoutGuideIcon, LayoutMinimalIcon, LayoutSidebarIcon } from '../../components/icons';
import { ModelChip } from '../../components/ModelChip';
import { Segmented } from '../../components/Segmented';
import { StatusChip } from '../../components/StatusChip';
import { Tag } from '../../components/Tag';
import { CLAUDE_SETTINGS_ROUTE, pathFor, type ScreenId } from '../routes';
import { BranchBlock } from './BranchBlock';
import { ContextText } from './ContextText';
import { PLACEHOLDER } from './placeholders';
import { RepoSwitcher } from './RepoSwitcher';
import { StatusText } from './StatusText';
import { TitleBar } from './TitleBar';

const P = PLACEHOLDER;
const noop = () => undefined;

const MODE_OPTIONS = [
  { value: 'focus', label: 'Focus' },
  { value: 'detailed', label: 'Detailed' },
] as const;

const LAYOUT_OPTIONS = [
  {
    value: 'A',
    label: 'Sidebar layout (Ctrl+1)',
    title: 'Sidebar · Ctrl+1',
    icon: <LayoutSidebarIcon />,
  },
  {
    value: 'B',
    label: 'Minimal layout (Ctrl+2)',
    title: 'Minimal · Ctrl+2',
    icon: <LayoutMinimalIcon />,
  },
  {
    value: 'C',
    label: 'Guide layout (Ctrl+3)',
    title: 'Guide · Ctrl+3',
    icon: <LayoutGuideIcon />,
  },
] as const;

function SessionContext({ iid = P.mr.iid, title = P.mr.title }: { iid?: string; title?: string }) {
  return (
    <>
      <ContextText kind="repo">{P.repo.name}</ContextText>
      <ContextText kind="iid">{iid}</ContextText>
      <ContextText kind="title">{title}</ContextText>
    </>
  );
}

/** Focus/Detailed toggle (F-08.1, M4) and Finish review (F-30.3, M4): static until then. */
function StepControls({ mode, model }: { mode: 'focus' | 'detailed'; model: ReactNode }) {
  return (
    <>
      <Segmented label="Mode" size="bar" options={MODE_OPTIONS} value={mode} onChange={noop} />
      {mode === 'focus' && (
        <Segmented label="Layout" size="bar" options={LAYOUT_OPTIONS} value="A" onChange={noop} />
      )}
      {model}
      <Button variant="primary" size={28}>
        Finish review
      </Button>
    </>
  );
}

export interface ScreenTitleBarProps {
  screen: ScreenId;
}

/** The title bar with each screen's context and controls (docs/02 › Shell table). */
export function ScreenTitleBar({ screen }: ScreenTitleBarProps) {
  const navigate = useNavigate();
  const chip = (label: string) => (
    <ModelChip
      label={label}
      onOpen={() => {
        void navigate(pathFor(CLAUDE_SETTINGS_ROUTE));
      }}
    />
  );

  switch (screen) {
    case 'S-01':
      return (
        <TitleBar
          context={<RepoSwitcher name={P.repo.name} path={P.repo.path} />}
          wideControls
          controls={
            <>
              <StatusText color="green">{P.gitlabStatus}</StatusText>
              {chip(P.claudeStatus)}
            </>
          }
        />
      );
    case 'S-02':
      return (
        <TitleBar
          context={
            <>
              <ContextText kind="repo">{P.repo.name}</ContextText>
              <ContextText kind="iid">{P.mr.iid}</ContextText>
              <ContextText kind="label">Review plan</ContextText>
            </>
          }
          controls={
            <>
              <StatusText color="purple">{P.planStatus}</StatusText>
              {chip(P.model.plan)}
            </>
          }
        />
      );
    case 'S-03':
      return (
        <TitleBar
          context={<SessionContext />}
          controls={<StepControls mode="focus" model={chip(P.model.step)} />}
        />
      );
    case 'S-04':
      return (
        <TitleBar
          context={<SessionContext />}
          controls={<StepControls mode="detailed" model={chip(P.model.step)} />}
        />
      );
    case 'S-05':
      return <TitleBar context={<SessionContext />} controls={chip(P.model.summary)} />;
    case 'S-06':
      return (
        <TitleBar
          context={
            <>
              <RepoSwitcher name={P.repo.name} path={P.repo.path} />
              <BranchBlock branch={P.branch} />
            </>
          }
          controls={chip(P.model.commit)}
        />
      );
    case 'S-07':
      return (
        <TitleBar
          context={
            <>
              <ContextText kind="repo">{P.repo.name}</ContextText>
              <ContextText kind="title">Settings</ContextText>
            </>
          }
        />
      );
    case 'S-08':
      return <TitleBar context={<SessionContext />} controls={chip(P.model.pipeline)} />;
    case 'S-09':
      return (
        <TitleBar
          context={<SessionContext iid={P.rereviewMr.iid} title={P.rereviewMr.title} />}
          controls={chip(P.model.rereview)}
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
              {chip(P.model.author)}
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
          controls={chip(P.model.createMr)}
        />
      );
  }
}
