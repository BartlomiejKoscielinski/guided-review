/**
 * The step S-03 shows: `?step=`, else the one the session was on before (F-04.3), else step 1
 * of the reader's order; `undefined` while the order isn't known.
 */
export function currentStep(
  param: string | null,
  kept: string | null | undefined,
  order: readonly string[],
): string | undefined {
  if (param !== null && param !== '') return param;
  if (kept !== null && kept !== undefined && order.includes(kept)) return kept;
  return order[0];
}
