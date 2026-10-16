import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { isArrowWidget } from '../../app/keyboard';
import { isShortcutKey, type ShortcutId } from '../../app/shortcuts';
import { pageChange, scrollRootTo } from '../../diff/currentChange';
import type { FileDiff } from '../../ipc/types/FileDiff';
import { useWalkStore } from '../../state/walk';
import { pathOf } from './diffPath';
import { nextNonce } from './lineComment';

/** The change the arrow keys made current (F-30.6, M4 decisions 14 and 15). */
export interface CurrentChange {
  file: string;
  /** The hunk's `id`; empty for a file without lines to show (binary), whose header is the stop. */
  hunk: string;
  /** Each move gets a new one, which scrolls the change (or its file) to the top again. */
  nonce: number;
  /** What the move scrolls to the top: the change (`↓`/`↑`) or its file's header (`→`/`←`). */
  scroll: 'change' | 'file';
  /** The walk waits here once before it leaves the step: at its start (`↑`) or end (`↓`). */
  pause?: 'start' | 'end';
}

/** The current change of the step on screen; another step's is dropped. */
export function useCurrentChange(
  stepId: string,
): [CurrentChange | null, (change: CurrentChange | null) => void] {
  const [state, setState] = useState<{ stepId: string; change: CurrentChange } | null>(null);
  const set = useCallback(
    (change: CurrentChange | null) => {
      setState(change && { stepId, change });
    },
    [stepId],
  );
  return [state?.stepId === stepId ? state.change : null, set];
}

interface Stop {
  file: string;
  hunk: string;
}

/**
 * The walk's stops over the step's files in diff order: each change (hunk; a closed fold is one,
 * as its hunk), and a file without lines to show is one stop of its own.
 */
function stopsOf(files: readonly FileDiff[]): Stop[] {
  return files.flatMap((file) => {
    const path = pathOf(file);
    const hunks = file.hunks.filter((h) => !h.fileLevel);
    return hunks.length > 0
      ? hunks.map((h) => ({ file: path, hunk: h.id }))
      : [{ file: path, hunk: '' }];
  });
}

interface Walk {
  down: (repeat: boolean) => void;
  up: (repeat: boolean) => void;
  file: (direction: 1 | -1) => void;
}

/** The arrow keys of the shortcuts table and what each does on the walk. */
const ARROWS: readonly [ShortcutId, (walk: Walk, repeat: boolean) => void][] = [
  [
    'nextChange',
    (walk, repeat) => {
      walk.down(repeat);
    },
  ],
  [
    'prevChange',
    (walk, repeat) => {
      walk.up(repeat);
    },
  ],
  [
    'nextFile',
    (walk) => {
      walk.file(1);
    },
  ],
  [
    'prevFile',
    (walk) => {
      walk.file(-1);
    },
  ],
];

export interface ArrowWalkOptions {
  sessionId: string;
  stepId: string;
  /** The step's files (`StepView.files`); undefined while the step loads (no walk yet). */
  files: readonly FileDiff[] | undefined;
  current: CurrentChange | null;
  setCurrent: (change: CurrentChange | null) => void;
  /** Marks a file of the step reviewed; a marked file stays marked (F-07.10). */
  mark: (path: string) => void;
  /** The previous and next step of the reader's order (`StepView.prev`, `next`). */
  prev: string | undefined;
  next: string | undefined;
  go: (stepId: string) => void;
  /** The step's column: the pause at the step's start shows its top. */
  scrollRoot: RefObject<HTMLElement | null>;
  /** The pause at the step's end is on: S-04 brings its end-of-step card into view. */
  onEnd?: () => void;
  /** `↓` at the end of the last step: Finish review takes the focus. */
  onFinish: () => void;
}

/**
 * The arrow keys of S-03 and S-04 (F-30.6, M4 decision 15), read from the shortcuts table. `↓`
 * makes the next change current; a change taller than the screen first scrolls a screen at a
 * time; past a file's last change it marks the file reviewed (never takes a mark back) and goes
 * to the next file's first change; past the step's last file it marks it and pauses once, and the
 * next `↓` opens the next step at its first change - after the last step the focus goes to Finish
 * review. `↑` walks back the same way, pausing once at the step's start before it opens the
 * previous step at its last change, and never unmarks. A held `↓` or `↑` stops at the end of a
 * file. `→`/`←` make the next or previous file's first change current without marking, stopping
 * at the step's ends. The keys stay with text fields, menus, list boxes, radio groups and
 * selects and with Ctrl, Alt (AltGr) or Shift held; a handled key doesn't scroll the page.
 */
export function useArrowWalk({
  sessionId,
  stepId,
  files,
  current,
  setCurrent,
  mark,
  prev,
  next,
  go,
  scrollRoot,
  onEnd,
  onFinish,
}: ArrowWalkOptions): void {
  // `↓`/`↑` into another step open it at its first or last change once its files are read.
  useEffect(() => {
    if (files === undefined) return;
    const at = useWalkStore.getState().take(sessionId, stepId);
    if (at === null) return;
    const stops = stopsOf(files);
    const stop = at === 'first' ? stops[0] : stops.at(-1);
    if (stop) setCurrent({ ...stop, nonce: nextNonce(), scroll: 'change' });
  }, [files, sessionId, stepId, setCurrent]);

  const stops = files ? stopsOf(files) : [];
  const at = current
    ? stops.findIndex((s) => s.file === current.file && s.hunk === current.hunk)
    : -1;
  const show = (stop: Stop, scroll: CurrentChange['scroll']) => {
    setCurrent({ ...stop, nonce: nextNonce(), scroll });
  };
  const leave = (direction: 1 | -1) => {
    const to = direction > 0 ? next : prev;
    if (to !== undefined) {
      useWalkStore
        .getState()
        .enter({ sessionId, stepId: to, at: direction > 0 ? 'first' : 'last' });
      go(to);
    } else if (direction > 0) {
      onFinish();
    }
  };

  const down = (repeat: boolean) => {
    const here = stops[at];
    if (!current || !here) {
      const first = stops[0];
      if (first) show(first, 'change');
      return;
    }
    if (current.pause === 'end') {
      if (!repeat) leave(1);
      return;
    }
    if (pageChange(here.file, here.hunk, 1)) return;
    const after = stops[at + 1];
    if (after && after.file === here.file) {
      show(after, 'change');
      return;
    }
    // The end of a file: a held key stops here; a new press marks it and goes on.
    if (repeat) return;
    mark(here.file);
    if (after) {
      show(after, 'change');
    } else {
      setCurrent({ ...current, pause: 'end' });
      onEnd?.();
    }
  };

  const up = (repeat: boolean) => {
    const here = stops[at];
    // A step opened without a move is at its start, as after the pause there.
    if (!current || !here || current.pause === 'start') {
      if (!repeat) leave(-1);
      return;
    }
    if (current.pause !== 'end' && pageChange(here.file, here.hunk, -1)) return;
    const before = stops[at - 1];
    if (!before) {
      if (repeat) return;
      setCurrent({ ...current, pause: 'start' });
      const root = scrollRoot.current;
      if (root) scrollRootTo(root, 0);
      return;
    }
    if (repeat && before.file !== here.file) return;
    show(before, 'change');
  };

  const file = (direction: 1 | -1) => {
    const paths = files?.map(pathOf) ?? [];
    const from = current ? paths.indexOf(current.file) : 0;
    const to = Math.min(paths.length - 1, Math.max(0, from + direction));
    if (current && to === from) return;
    const stop = stops.find((s) => s.file === paths[to]);
    if (stop) show(stop, 'file');
  };

  const latest = useRef({ ready: false, down, up, file });
  useEffect(() => {
    latest.current = { ready: files !== undefined, down, up, file };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isArrowWidget(event.target)) return;
      const walk = latest.current;
      const action = ARROWS.find(([id]) => isShortcutKey(event, id))?.[1];
      if (!action || !walk.ready) return;
      event.preventDefault();
      action(walk, event.repeat);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
