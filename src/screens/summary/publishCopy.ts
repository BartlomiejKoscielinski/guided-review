import type { PublishOutcome } from '../../ipc/types/PublishOutcome';

const comments = (n: number) => `${String(n)} ${n === 1 ? 'comment' : 'comments'}`;

/**
 * The banner after a Publish (F-12.5, SummaryDesk.dc.html): "Published 5 comments and a summary.
 * The author got a single notification."; with a failure (M5 decision 9) "Published 3 of 5. 2
 * failed: <reason of the first failure>.".
 */
export function publishedText({ published, summary, failed }: PublishOutcome): string {
  const sent = published.length;
  const [first] = failed;
  if (first) {
    const asked = sent + failed.length;
    return `Published ${String(sent)} of ${String(asked)}. ${String(failed.length)} failed: ${first.reason}.`;
  }
  return `Published ${comments(sent)}${summary ? ' and a summary' : ''}. The author got a single notification.`;
}

/** M5 decision 8: the drafts a Publish would send that the user wrote in GitLab's web UI. */
export function foreignText(n: number): string {
  const what = n === 1 ? '1 draft comment' : `${String(n)} draft comments`;
  return `You have ${what} in GitLab's own review. Publishing here sends ${n === 1 ? 'it' : 'them'} too.`;
}

/** M5 decision 10b: the location of a draft whose line is gone from the MR's newer version. */
export const LINE_CHANGED = 'line changed, published as a general comment';
