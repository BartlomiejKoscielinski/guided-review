import { useEffect, useRef, useState } from 'react';
import { useIpc } from '../../ipc/IpcContext';
import { useMrTitle } from '../../ipc/hooks/useMrTitle';
import type { MrDescription } from '../../ipc/types/MrDescription';
import type { MrDescriptionVariant } from '../../ipc/types/MrDescriptionVariant';

/** The description S-11 opens with (M7 decision 15): the sections Claude fills, still empty. */
export const SKELETON = '## What\n\n## Why\n\n## How to test\n1. ';

let taskCount = 0;
const nextTask = () => {
  taskCount += 1;
  return `mr-description-${String(taskCount)}`;
};

export interface MrText {
  title: string;
  description: string;
  setTitle: (value: string) => void;
  setDescription: (value: string) => void;
  /** Claude has written the fields at least once (the field's label shows). */
  written: boolean;
  busy: boolean;
  error: string | null;
  /** What the regenerate slot does next: `normal` until Claude wrote, then short / long. */
  next: MrDescriptionVariant;
  /** The question "Replace your edits?" is open for this variant. */
  asking: MrDescriptionVariant | null;
  /** The slot's click: asks first over the user's edits (M7 decision 16), else runs. */
  regenerate: () => void;
  replace: () => void;
  cancelReplace: () => void;
}

/**
 * The Title and Description of S-11 (F-27.2). The title comes from the commits (`chosen` target,
 * the default when undefined) until the user edits it or Claude writes; Claude runs only on a
 * click (Write with Claude, Shorter / Longer version), or on mount when S-11 was opened by the
 * self-review's Draft MR description (`autoStart`, M7 decision 15; `claimAutoStart` says whether
 * this mount may run it). Text the user edited since
 * it was last set is replaced only after the question (decision 16).
 */
export function useMrText(
  chosen: string | undefined,
  target: string | undefined,
  autoStart: boolean,
  claimAutoStart: () => boolean,
): MrText {
  const ipc = useIpc();
  const fromCommits = useMrTitle(chosen);
  const [claude, setClaude] = useState<MrDescription | null>(null);
  const [variant, setVariant] = useState<MrDescriptionVariant | null>(null);
  // `null`: the field shows what the app last set (commits or Claude), untouched.
  const [titleEdit, setTitleEdit] = useState<string | null>(null);
  const [descriptionEdit, setDescriptionEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(autoStart);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<MrDescriptionVariant | null>(null);
  const started = useRef(false);

  const baseTitle = claude?.title ?? fromCommits.data ?? '';
  const baseDescription = claude?.description ?? SKELETON;
  const title = titleEdit ?? baseTitle;
  const description = descriptionEdit ?? baseDescription;
  const edited = title !== baseTitle || description !== baseDescription;
  const next: MrDescriptionVariant =
    claude === null ? 'normal' : variant === 'short' ? 'long' : 'short';

  /** The run itself; the caller has set `busy`. */
  const start = (asked: MrDescriptionVariant) => {
    ipc.claudeMrDescription(nextTask(), asked, target).then(
      (result) => {
        setClaude(result);
        setVariant(asked);
        setTitleEdit(null);
        setDescriptionEdit(null);
        setError(null);
        setBusy(false);
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      },
    );
  };

  const run = (asked: MrDescriptionVariant) => {
    setAsking(null);
    setBusy(true);
    setError(null);
    start(asked);
  };

  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    if (claimAutoStart()) start('normal');
    // Once per mount: the click that opened S-11 asked for one run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    title,
    description,
    setTitle: setTitleEdit,
    setDescription: setDescriptionEdit,
    written: claude !== null,
    busy,
    error,
    next,
    asking,
    regenerate: () => {
      if (busy) return;
      if (edited) setAsking(next);
      else run(next);
    },
    replace: () => {
      if (asking !== null) run(asking);
    },
    cancelReplace: () => {
      setAsking(null);
    },
  };
}
