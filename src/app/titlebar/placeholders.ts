/**
 * Example values from the design mocks for title-bar controls whose data arrives in a later
 * milestone (docs/07 › Criteria that point at later milestones). Each line names who replaces it.
 */
export const PLACEHOLDER = {
  /** Repository switcher (F-30.7, M2). */
  repo: { name: 'mobile-app', path: 'C:\\src\\mobile-app' },
  /** GitLab status on S-01 (F-01.6, M2). */
  gitlabStatus: 'GitLab connected',
  /** Claude Code status chip on S-01 (F-01.6, F-18.1, M1). */
  claudeStatus: 'Claude Code signed in',
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
  /** Model chips: model · effort of the screen's task (F-18.5, M1). */
  model: {
    plan: 'Opus 5.5 · high',
    step: 'Sonnet 5.5 · medium',
    summary: 'Sonnet 5.5 · low',
    commit: 'Haiku 5.5 · low',
    pipeline: 'Sonnet 5.5 · low',
    rereview: 'Sonnet 5.5 · medium',
    author: 'Sonnet 5.5 · medium',
    createMr: 'Sonnet 5.5 · low',
  },
} as const;
