import type { UnfinishedSession } from '../../types/UnfinishedSession';

/**
 * No review sessions exist until M3, so the Review tile is dimmed. The "Pick up where you left
 * off" sessions of Start.dc.html (!471, local chore/compiled-bindings) join with F-04.1.
 */
export const unfinishedSessions: UnfinishedSession[] = [];
