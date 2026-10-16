import { useCallback, type ReactNode } from 'react';
import { useDrafts } from '../../ipc/hooks/useDrafts';
import type { FileDiff } from '../../ipc/types/FileDiff';
import type { Fold } from '../../ipc/types/Fold';
import { reviewKey, useReviewStore, useStepReview } from '../../state/review';
import {
  firstChangedLine,
  lastPicked,
  lineDraftsOf,
  nextNonce,
  sameAnchor,
  type LineAnchor,
} from './lineComment';
import { LineComposer } from './LineComposer';
import { useCommentKey } from './useCommentKey';

/** A card under a diff line: a line comment of the step, or the open composer. */
export interface LineCard extends LineAnchor {
  id: string;
  node: ReactNode;
  /** The open composer: brought into view each time it opens (a growing number). */
  reveal?: number;
}

export interface LineCommentsOptions {
  sessionId: string;
  /** Empty while the step is not known yet. */
  stepId: string;
  /** The step's files as the screen draws them. */
  files: readonly FileDiff[];
  /** Claude's folds the screen draws (S-03); S-04 has none. */
  folds: readonly Fold[];
  selfReview: boolean;
}

/**
 * Line comments on the open step (F-09.7, M4 decision 13), shared by S-03 and S-04. `C` opens the
 * composer under the last selected line, else under the step's first changed line the reader
 * sees; Comment in the "Selected lines" group calls `open`. The step's drafts on a line with no
 * note show as cards under their lines, so the reader finds their comments where they wrote them.
 */
export function useLineComments({
  sessionId,
  stepId,
  files,
  folds,
  selfReview,
}: LineCommentsOptions): { cards: LineCard[]; open: (at: LineAnchor) => void } {
  const key = reviewKey(sessionId, stepId);
  const comment = useStepReview(key, 'comment');
  const picked = useStepReview(key, 'picked');
  const change = useReviewStore((s) => s.change);
  const drafts = useDrafts(sessionId).data;

  /** Opens the composer at `at`; on the line of the composer already open, focuses its text. */
  const open = useCallback(
    (at: LineAnchor, text = '', covers: string | null = null) => {
      change(key, (s) => {
        const old = s.comment;
        if (old?.draft === null && text === '' && sameAnchor(old, at)) {
          return { comment: { ...old, focus: old.focus + 1 } };
        }
        return { comment: { ...at, text, draft: null, covers, nonce: nextNonce(), focus: 0 } };
      });
    },
    [change, key],
  );

  useCommentKey(() => {
    if (stepId === '') return;
    const at = picked ? lastPicked(picked) : firstChangedLine(files, folds);
    if (at) open(at);
  });

  const cards: LineCard[] = [];
  for (const draft of lineDraftsOf(drafts ?? [], stepId, comment?.covers ?? null)) {
    const at: LineAnchor = { ...draft.position };
    const id = `draft-${draft.id}`;
    cards.push({
      ...at,
      id,
      node: (
        <LineComposer
          key={id}
          sessionId={sessionId}
          anchor={at}
          selfReview={selfReview}
          draft={{ id: draft.id, body: draft.body }}
          onUndone={(body) => {
            open(at, body, draft.id);
          }}
        />
      ),
    });
  }
  if (comment) {
    const at: LineAnchor = { file: comment.file, side: comment.side, line: comment.line };
    const { nonce } = comment;
    const id = `comment-${String(nonce)}`;
    cards.push({
      ...at,
      id,
      reveal: nonce,
      node: (
        <LineComposer
          key={id}
          sessionId={sessionId}
          anchor={at}
          selfReview={selfReview}
          draft={comment.draft}
          text={comment.text}
          focus={comment.focus}
          onAdded={(draft) => {
            change(key, (s) =>
              s.comment?.nonce === nonce
                ? {
                    comment: {
                      ...s.comment,
                      draft: { id: draft.id, body: draft.body },
                      covers: draft.id,
                    },
                  }
                : {},
            );
          }}
          onCancel={() => {
            change(key, () => ({ comment: null }));
          }}
          onUndone={(body) => {
            open(at, body, comment.draft?.id ?? null);
          }}
        />
      ),
    });
  }
  return { cards, open };
}
