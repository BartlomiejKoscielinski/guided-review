import { useState } from 'react';
import type { Finding } from '../../ipc/types/Finding';
import type { Severity } from '../../ipc/types/Severity';
import { useReviewStore, useStepReview } from '../../state/review';

const SEVERITY_RANK: Record<Severity, number> = { fix: 0, q: 1, nit: 2 };

/**
 * The note focused when a step opens: the first open note of the highest severity (Review.dc.html
 * opens on its first Should fix, f2), else the first note.
 */
function firstFocus(findings: Finding[]): string | null {
  const open = findings.filter((f) => f.decision === 'open');
  const pick = [...open].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0];
  return pick?.id ?? findings[0]?.id ?? null;
}

/**
 * The step's focused note in S-03 and S-04: the one the reader picked (kept in `state/review.ts`
 * across a mode switch), else the step's first open note of the highest severity.
 */
export function useStepFocus(key: string, findings: Finding[]) {
  const change = useReviewStore((s) => s.change);
  const focus = useStepReview(key, 'focus');
  // Picked once per set of notes, so deciding the focused note doesn't move the focus away.
  const [initial, setInitial] = useState<{ ids: string; id: string | null } | null>(null);
  const ids = findings.map((f) => f.id).join(' ');
  if (initial?.ids !== ids) setInitial({ ids, id: firstFocus(findings) });
  const focused = focus ?? (initial?.ids === ids ? initial.id : firstFocus(findings));
  const setFocus = (id: string) => {
    change(key, () => ({ focus: id }));
  };
  return { focused, setFocus };
}
