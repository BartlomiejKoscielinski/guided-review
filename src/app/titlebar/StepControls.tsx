import type { ReactNode } from 'react';
import { Button } from '../../components/Button';
import { LayoutGuideIcon, LayoutMinimalIcon, LayoutSidebarIcon } from '../../components/icons';
import { Segmented } from '../../components/Segmented';
import type { FocusLayout } from '../../state/focus';
import { ContextText } from './ContextText';
import { PLACEHOLDER } from './placeholders';
import { useFinishReview } from './useFinishReview';

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

export function SessionContext({
  iid = P.mr.iid,
  title = P.mr.title,
}: {
  iid?: string;
  title?: string;
}) {
  return (
    <>
      <ContextText kind="repo">{P.repo.name}</ContextText>
      <ContextText kind="iid">{iid}</ContextText>
      <ContextText kind="title">{title}</ContextText>
    </>
  );
}

export interface StepControlsProps {
  mode: 'focus' | 'detailed';
  model: ReactNode;
  /** The shared Focus layout (F-07.1); only shown in Focus mode. */
  layout?: FocusLayout;
  onLayout?: (layout: FocusLayout) => void;
}

/** Focus/Detailed toggle (F-08.1, M4), the layout switch (F-07.1) and Finish review (F-30.3, M4). */
export function StepControls({ mode, model, layout = 'A', onLayout = noop }: StepControlsProps) {
  const finishReview = useFinishReview();
  return (
    <>
      <Segmented label="Mode" size="bar" options={MODE_OPTIONS} value={mode} onChange={noop} />
      {mode === 'focus' && (
        <Segmented
          label="Layout"
          size="bar"
          options={LAYOUT_OPTIONS}
          value={layout}
          onChange={onLayout}
        />
      )}
      {model}
      <Button variant="primary" size={28} onClick={finishReview}>
        Finish review
      </Button>
    </>
  );
}
