import styles from './Switch.module.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name when no visible label is linked with `labelledBy`. */
  label?: string;
  /** Id of the element whose text names the switch (the row label in Settings). */
  labelledBy?: string;
  disabled?: boolean;
}

/** On/off control with `role="switch"`; Space and Enter toggle it (native button). */
export function Switch({ checked, onChange, label, labelledBy, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      className={styles.switch}
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span className={styles.knob} />
    </button>
  );
}
