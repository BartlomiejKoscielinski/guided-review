import { Button } from '../../components/Button';
import type { LineSelection } from '../../ipc/types/LineSelection';
import { selectionLabel } from './lineSelection';
import styles from './Step.module.css';

export interface SelectionBarProps {
  selection: LineSelection;
  onAsk: () => void;
  onClear: () => void;
}

/** "Selected lines" under the last selected line (F-10.1): the lines, Ask Claude and Clear. */
export function SelectionBar({ selection, onAsk, onClear }: SelectionBarProps) {
  return (
    <div role="group" aria-label="Selected lines" className={styles.selectionBar}>
      <span className={styles.selectionLabel}>{selectionLabel(selection)}</span>
      <Button variant="claude" size={28} onClick={onAsk}>
        Ask Claude
      </Button>
      <Button variant="ghost" size={28} onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
