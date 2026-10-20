/**
 * The jobs whose latest attempt failed again on the same test as the attempt before it (F-20.9,
 * M6 decision 15), as `<pipeline>:<job name>`: Pipeline.dc.html's ui-tests:android of #18342,
 * whose UI test waits for the old id and times out on every retry.
 */
const FAILED_AGAIN = new Set(['18342:ui-tests:android']);

/** Whether failed job `name` of `pipeline` failed again on the same test (F-20.9). */
export function failedAgain(pipeline: number, name: string): boolean {
  return FAILED_AGAIN.has(`${String(pipeline)}:${name}`);
}
