import styles from './DiffView.module.css';

export interface FoldRowProps {
  label: string;
  onShow: () => void;
}

/** A mechanical region collapsed inside a step: "Fields and constructor: 3 new dependencies" · Show (F-07.4). */
export function FoldRow({ label, onShow }: FoldRowProps) {
  return (
    <div className={styles.fold}>
      <span>{label}</span>
      <button type="button" className={styles.show} onClick={onShow}>
        Show
      </button>
    </div>
  );
}
