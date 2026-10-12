/**
 * Example values from the design mocks for title-bar controls whose data arrives in a later
 * milestone (docs/07 › Criteria that point at later milestones). Each line names who replaces it.
 */
export const PLACEHOLDER = {
  /** Repository of review screens (the session's, M3). */
  repo: { name: 'mobile-app', path: 'C:\\src\\mobile-app' },
  /** Session context of review screens (M3). */
  mr: { iid: '!482', title: 'Offline queue for delivery photos' },
  /** S-09 context (M8). */
  rereviewMr: { iid: '!471', title: 'Signature screen: field validation' },
  /** S-10 context (M7). */
  authorMr: { iid: '!480', title: 'Retry in UploadWorker after network loss' },
  /** Branch block on S-06 and S-11 (M1, M7). */
  branch: 'chore/compiled-bindings',
  /** S-02 status (F-06.12, M3). */
  planStatus: 'Plan ready · Claude is analyzing step 1',
  /** S-10 pipeline status (F-26.1, M7). */
  pipelineStatus: 'Pipeline passed',
} as const;
