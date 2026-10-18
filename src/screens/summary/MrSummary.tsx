import { useId, useState } from 'react';
import { useLocation } from 'react-router';
import type { StartState } from '../../app/router';
import { useDiscussions } from '../../ipc/hooks/useDiscussions';
import { useDrafts } from '../../ipc/hooks/useDrafts';
import { DraftsOnlyHeader } from './DraftsOnlyHeader';
import { DraftsTab } from './DraftsTab';
import { ForeignDraftsBanner } from './ForeignDraftsBanner';
import { openingTab, openThreadCount, type SummaryTab } from './openingTab';
import { PublishBanner } from './PublishBanner';
import { PublishBar } from './PublishBar';
import { SummaryCommentField } from './SummaryCommentField';
import { SummaryHeader } from './SummaryHeader';
import { SummaryTabs } from './SummaryTabs';
import { usePublishFlow } from './usePublishFlow';
import { useSummaryComment } from './useSummaryComment';
import styles from './Summary.module.css';

export interface MrSummaryProps {
  sessionId: string;
  /** A "drafts only" session (F-12.7): no steps, so no progress line and no Back to steps. */
  draftsOnly?: boolean;
}

/**
 * S-05 of an MR session (F-12.1, SummaryDesk.dc.html): "SUMMARY", how many steps are reviewed and
 * Back to steps; below, the Comments column with the tabs Drafts N and Threads N open (F-12.2)
 * and the drafts list (F-12.3) with "Add a summary comment" under it (F-12.4); on the Drafts tab
 * Publish (N) next to the tabs and its banners above the rows (F-12.5). The threads list (F-13.1)
 * and the Approval tile (F-14) fill the page as their criteria land. A "drafts only" session, made
 * by a draft from outside a review, is the same summary without its steps (F-12.7).
 */
export function MrSummary({ sessionId, draftsOnly = false }: MrSummaryProps) {
  const id = useId();
  // Restored on start no GitLab command runs (F-30.4): the open threads are counted once the
  // summary is opened again; the drafts are on this PC and are read either way.
  const restored = (useLocation().state as StartState | null)?.restored === true;
  const drafts = useDrafts(sessionId);
  const threads = useDiscussions(sessionId, !restored);
  // Held by the screen, not the tab: a summary run outlives a switch to Threads (F-12.4).
  const comment = useSummaryComment(sessionId);
  const publish = usePublishFlow(sessionId, drafts.data, comment.field, !restored);
  // M5 decision 5: the opening tab is picked once and kept while the screen is open; leaving the
  // screen (it unmounts) ends the choice. The tabs wait for it, so no tab shows first and then
  // gives way to the other.
  const [picked, setPicked] = useState<SummaryTab | null>(null);
  const opening = openingTab(drafts, restored);
  if (picked === null && opening !== null) setPicked(opening);
  const tab = picked ?? opening;
  const panelId = `${id}-panel`;

  return (
    <div className={styles.screen}>
      <div className={styles.page}>
        {draftsOnly ? <DraftsOnlyHeader /> : <SummaryHeader sessionId={sessionId} />}
        <div className={styles.columns}>
          <section aria-label="Comments" className={styles.comments}>
            <div className={styles.commentsHead}>
              {tab && (
                <SummaryTabs
                  tab={tab}
                  onSelect={setPicked}
                  drafts={drafts.isError ? null : (drafts.data?.length ?? null)}
                  openThreads={
                    threads.data && !threads.isError ? openThreadCount(threads.data) : null
                  }
                  panelId={panelId}
                  idPrefix={`${id}-tab`}
                />
              )}
              {tab === 'drafts' && drafts.data && (
                <PublishBar
                  count={publish.count}
                  summaryOnly={publish.summaryOnly}
                  done={publish.done}
                  pending={publish.pending}
                  onPublish={publish.publish}
                />
              )}
            </div>
            {tab && (
              <div
                role="tabpanel"
                id={panelId}
                aria-labelledby={`${id}-tab-${tab}`}
                className={styles.panel}
              >
                {tab === 'drafts' && (
                  <>
                    <DraftsTab sessionId={sessionId} locked={publish.pending}>
                      {publish.foreign > 0 && <ForeignDraftsBanner count={publish.foreign} />}
                      {publish.outcome && (
                        <PublishBanner
                          outcome={publish.outcome}
                          canRetry={publish.canRetry}
                          onRetry={publish.retry}
                        />
                      )}
                      {publish.error && (
                        <p role="alert" className={styles.draftError}>
                          {publish.error.message}
                        </p>
                      )}
                    </DraftsTab>
                    {drafts.data && (
                      <SummaryCommentField comment={comment} locked={publish.pending} />
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
