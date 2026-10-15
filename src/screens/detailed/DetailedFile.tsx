import { useMemo, type RefObject } from 'react';
import { DiffView } from '../../diff/DiffView';
import { ignoreWhitespace } from '../../diff/whitespace';
import type { FileDiff } from '../../ipc/types/FileDiff';
import { useDetailedStore } from '../../state/detailed';
import { pathOf } from '../step/diffPath';
import { FileBar } from './FileBar';

export interface DetailedFileProps {
  sessionId: string;
  file: FileDiff;
  /** S-04's main column, which scrolls the step and its files. */
  scrollRoot: RefObject<HTMLElement | null>;
}

/**
 * One file of the S-04 step (F-08.5): its sticky file bar, then the diff in the view's layout,
 * with whitespace-only changes shown as unchanged lines when Ignore whitespace is on.
 */
export function DetailedFile({ sessionId, file, scrollRoot }: DetailedFileProps) {
  const path = pathOf(file);
  const layout = useDetailedStore((s) => s.layout);
  const setLayout = useDetailedStore((s) => s.setLayout);
  const ignore = useDetailedStore((s) => s.ignoreWhitespace);
  const setIgnore = useDetailedStore((s) => s.setIgnoreWhitespace);
  const diff = useMemo(() => (ignore ? ignoreWhitespace(file) : file), [file, ignore]);
  return (
    <section aria-label={path}>
      <FileBar
        sessionId={sessionId}
        file={file}
        path={path}
        layout={layout}
        onLayout={setLayout}
        ignoreWhitespace={ignore}
        onIgnoreWhitespace={setIgnore}
      />
      <DiffView
        path={path}
        diff={diff}
        layout={layout}
        scrollRoot={scrollRoot}
        empty={file.binary ? 'Binary file. Not shown.' : undefined}
      />
    </section>
  );
}
