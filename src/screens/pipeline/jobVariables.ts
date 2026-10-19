import type { JobVariable } from '../../ipc/types/JobVariable';

/** One editable row of the manual-job form (F-20.6); `id` keys it while rows come and go. */
export interface VariableRow {
  id: number;
  key: string;
  value: string;
}

/** GitLab's rule for a variable name (M6 decision 11). */
const NAME = /^[A-Za-z0-9_]+$/;

export const BAD_NAME = 'Letters, digits and _ only.';

/** Both fields empty: the row is dropped, not sent. */
const isBlank = (row: VariableRow) => row.key === '' && row.value === '';

/**
 * Why the row blocks Run (decision 11): an invalid name, or an empty name with a value; null for a
 * valid name (any value, an empty one too) and for a row with both fields empty.
 */
export function rowProblem(row: VariableRow): string | null {
  if (isBlank(row) || NAME.test(row.key)) return null;
  return BAD_NAME;
}

/** The variables Run sends: every row but the blank ones, in order and as typed. */
export function toSend(rows: VariableRow[]): JobVariable[] {
  return rows.filter((r) => !isBlank(r)).map((r) => ({ key: r.key, value: r.value }));
}
