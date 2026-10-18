import { Square } from '../../components/Square';
import type { ThreadHint } from '../../ipc/types/ThreadHint';
import styles from './Threads.module.css';

export interface ThreadHintChipProps {
  hint: ThreadHint;
}

/** How a commit is named on the chip: its first seven characters, as git shortens it. */
const SHORT_SHA = 7;

/**
 * Claude's hint on an open thread it judges addressed by a later commit (F-13.3,
 * SummaryDesk.dc.html): a purple square and "Claude: index added in a91f2c0" under the meta line.
 * The commit is the core's full id; the chip shows its first seven characters.
 */
export function ThreadHintChip({ hint }: ThreadHintChipProps) {
  return (
    <span className={styles.hint}>
      <Square color="purple" />
      Claude: {hint.hint} in {hint.commit.slice(0, SHORT_SHA)}
    </span>
  );
}
