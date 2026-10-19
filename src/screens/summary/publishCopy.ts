import type { PublishOutcome } from '../../ipc/types/PublishOutcome';

const comments = (n: number) => `${String(n)} ${n === 1 ? 'comment' : 'comments'}`;

/**
 * The banner after a Publish (F-12.5, SummaryDesk.dc.html): "Published 5 comments and a summary.
 * The author got a single notification.", "Published a summary. …" without drafts (M5 decision
 * 7); with a failure (M5 decision 9) "Published 3 of 5. 2 failed: <reason of the first failure>.",
 * and a summary comment that didn't go out adds "The summary failed: <reason>." ("… too." when
 * the reason is the same).
 */
export function publishedText({
  published,
  summary,
  failed,
  summaryFailed,
}: PublishOutcome): string {
  const sent = published.length;
  const [first] = failed;
  if (first) {
    const asked = sent + failed.length;
    const drafts = `Published ${String(sent)} of ${String(asked)}. ${String(failed.length)} failed: ${first.reason}.`;
    if (summaryFailed === undefined) return drafts;
    const why = summaryFailed === first.reason ? ' too' : `: ${summaryFailed}`;
    return `${drafts} The summary failed${why}.`;
  }
  if (summaryFailed !== undefined) {
    const lead = sent > 0 ? `Published ${comments(sent)}. ` : '';
    return `${lead}The summary failed: ${summaryFailed}.`;
  }
  const what =
    sent === 0 && summary ? 'a summary' : `${comments(sent)}${summary ? ' and a summary' : ''}`;
  return `Published ${what}. The author got a single notification.`;
}

/** M5 decision 8: the drafts a Publish would send that the user wrote in GitLab's web UI. */
export function foreignText(n: number): string {
  const what = n === 1 ? '1 draft comment' : `${String(n)} draft comments`;
  return `You have ${what} in GitLab's own review. Publishing here sends ${n === 1 ? 'it' : 'them'} too.`;
}

/** M5 decision 10b: the location of a draft whose line is gone from the MR's newer version. */
export const LINE_CHANGED = 'line changed, published as a general comment';
