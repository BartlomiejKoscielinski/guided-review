import { Square } from '../../components/Square';
import styles from './Notes.module.css';

/** "Claude" with the purple square, right-aligned in a note or answer card's head. */
export function ClaudeLabel() {
  return (
    <span className={styles.claude}>
      <Square color="purple" size={8} />
      Claude
    </span>
  );
}
