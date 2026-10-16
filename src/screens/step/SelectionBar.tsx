import { Button } from '../../components/Button';
import type { LineSelection } from '../../ipc/types/LineSelection';
import { selectionLabel } from './lineSelection';
import styles from './Step.module.css';

export interface SelectionBarProps {
  selection: LineSelection;
  onAsk: () => void;
  /** The line comment composer under the last selected line (F-09.7). */
  onComment: () => void;
  onClear: () => void;
}

/**
 * "Selected lines" under the last selected line (F-10.1, F-09.7): the lines, Ask Claude, Comment
 * and Clear.
 */
export function SelectionBar({ selection, onAsk, onComment, onClear }: SelectionBarProps) {
  return (
    <div role="group" aria-label="Selected lines" className={styles.selectionBar}>
      <span className={styles.selectionLabel}>{selectionLabel(selection)}</span>
      <Button variant="claude" size={28} onClick={onAsk}>
        Ask Claude
      </Button>
      <Button size={28} onClick={onComment}>
        Comment
      </Button>
      <Button variant="ghost" size={28} onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
