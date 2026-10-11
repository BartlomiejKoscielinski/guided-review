import styles from './StubScreen.module.css';

export interface StubScreenProps {
  /** Screen name for assistive technology; the content stays empty until the screen's milestone. */
  name: string;
}

/** Empty content area of a screen whose milestone hasn't come yet (docs/07 › M0). */
export function StubScreen({ name }: StubScreenProps) {
  return (
    <div className={styles.stub}>
      <h1 className="visually-hidden">{name}</h1>
    </div>
  );
}
