import { Checkbox } from '../../components/Checkbox';
import type { MrOptionValues } from './mrOptionValues';
import styles from './CreateMr.module.css';

const OPTIONS: readonly { key: keyof MrOptionValues; label: string }[] = [
  { key: 'draft', label: 'Mark as draft' },
  { key: 'deleteBranch', label: 'Delete branch after merge' },
  { key: 'squash', label: 'Squash commits' },
];

export interface MrOptionsProps {
  values: MrOptionValues;
  onChange: (values: MrOptionValues) => void;
}

/** S-11 options under the Description (F-27.4): one checkbox chip per option. */
export function MrOptions({ values, onChange }: MrOptionsProps) {
  return (
    <section aria-label="Options" className={styles.options}>
      {OPTIONS.map(({ key, label }) => (
        <Checkbox
          key={key}
          state={values[key] ? 'on' : 'off'}
          label={label}
          className={styles.option}
          onToggle={() => {
            onChange({ ...values, [key]: !values[key] });
          }}
        >
          {label}
        </Checkbox>
      ))}
    </section>
  );
}
