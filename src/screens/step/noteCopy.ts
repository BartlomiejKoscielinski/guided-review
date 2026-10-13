import type { BlockColor } from '../../components/colors';
import type { Severity } from '../../ipc/types/Severity';

/** Severity word tags (Main.dc.html SEV): orange Should fix, blue Question, grey Minor. */
export const SEVERITY_TAG: Record<Severity, { label: string; color: BlockColor | 'muted' }> = {
  fix: { label: 'Should fix', color: 'orange' },
  q: { label: 'Question', color: 'blue' },
  nit: { label: 'Minor', color: 'muted' },
};

/** Decision copy (F-09.3); self-review keeps notes to fix instead of drafting (M3 decision 2). */
export interface DecisionCopy {
  add: string;
  editAndAdd: string;
  added: string;
}

export const REVIEW_COPY: DecisionCopy = {
  add: 'Add to drafts',
  editAndAdd: 'Edit and add',
  added: 'Added to drafts. It reaches GitLab only when you publish.',
};

export const SELF_REVIEW_COPY: DecisionCopy = {
  add: 'Keep to fix',
  editAndAdd: 'Edit and keep',
  added: "Kept to fix. It's on your list at the end.",
};

export const DISMISSED = "Dismissed. Claude won't raise it again for this commit.";

export const decisionCopy = (selfReview: boolean): DecisionCopy =>
  selfReview ? SELF_REVIEW_COPY : REVIEW_COPY;
