import type { ReactNode } from 'react';
import { keysText, useShortcutKeys } from '../shortcuts';
import { Button } from '../../components/Button';
import { LayoutGuideIcon, LayoutMinimalIcon, LayoutSidebarIcon } from '../../components/icons';
import { Segmented } from '../../components/Segmented';
import type { Mode } from '../../ipc/types/Mode';
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

/** The layout switch's options with the keys of the layout shortcuts now (F-07.1, F-19.7). */
function useLayoutOptions() {
  const sidebar = keysText(useShortcutKeys('sidebarLayout'));
  const minimal = keysText(useShortcutKeys('minimalLayout'));
  const guide = keysText(useShortcutKeys('guideLayout'));
  return [
    {
      value: 'A',
      label: `Sidebar layout (${sidebar})`,
      title: `Sidebar · ${sidebar}`,
      icon: <LayoutSidebarIcon />,
    },
    {
      value: 'B',
      label: `Minimal layout (${minimal})`,
      title: `Minimal · ${minimal}`,
      icon: <LayoutMinimalIcon />,
    },
    {
      value: 'C',
      label: `Guide layout (${guide})`,
      title: `Guide · ${guide}`,
      icon: <LayoutGuideIcon />,
    },
  ] as const;
}

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
  mode: Mode;
  /** Focus | Detailed (F-08.1): the other mode on the same step. */
  onMode?: (mode: Mode) => void;
  model: ReactNode;
  /** The shared Focus layout (F-07.1); only shown in Focus mode. */
  layout?: FocusLayout;
  onLayout?: (layout: FocusLayout) => void;
}

/** Focus/Detailed toggle (F-08.1), the layout switch (F-07.1) and Finish review (F-30.3, M4). */
export function StepControls({
  mode,
  onMode = noop,
  model,
  layout = 'A',
  onLayout = noop,
}: StepControlsProps) {
  const finishReview = useFinishReview();
  const layoutOptions = useLayoutOptions();
  return (
    <>
      <Segmented label="Mode" size="bar" options={MODE_OPTIONS} value={mode} onChange={onMode} />
      {mode === 'focus' && (
        <Segmented
          label="Layout"
          size="bar"
          options={layoutOptions}
          value={layout}
          onChange={onLayout}
        />
      )}
      {model}
      <Button variant="primary" size={28} onClick={finishReview} data-finish-review>
        Finish review
      </Button>
    </>
  );
}
