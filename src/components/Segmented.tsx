import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';
import styles from './Segmented.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  /** Visible text, or the accessible name of an icon-only option. */
  label: string;
  /** Icon-only option: the icon is shown and `label` becomes its accessible name. */
  icon?: ReactNode;
  /** Native tooltip, e.g. "Sidebar · Ctrl+1". */
  title?: string;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  /** Accessible name of the group ("Start in", "Mode"). */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * "bar" = 28px title-bar control, "tool" = 30px toolbar control (S-06 Unified | Split),
   * "fill" = 32px options sharing the full width (S-06 source toggle), "form" = 40px settings.
   */
  size?: 'bar' | 'tool' | 'fill' | 'form';
  /** Fill of the selected option (white block by default). */
  tone?: 'white' | 'yellow' | 'purple' | 'green';
  /** Values in mono lowercase (effort levels in Settings › Claude). */
  mono?: boolean;
}

/**
 * Single choice among a few options, as an ARIA radio group: one tab stop, arrow keys move
 * and select, Home/End jump to the ends (NFR-06).
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'form',
  tone = 'white',
  mono = false,
}: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.flatMap((o, i) => (o.disabled ? [] : [i]));
  const selectedIndex = options.findIndex((o) => o.value === value);
  const tabStop = selectedIndex >= 0 ? selectedIndex : (enabled[0] ?? -1);

  const select = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    refs.current[index]?.focus();
    if (option.value !== value) onChange(option.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const at = enabled.indexOf(index);
    let target: number | undefined;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        target = enabled[(at + 1) % enabled.length];
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        target = enabled[(at - 1 + enabled.length) % enabled.length];
        break;
      case 'Home':
        target = enabled[0];
        break;
      case 'End':
        target = enabled[enabled.length - 1];
        break;
      default:
        return;
    }
    event.preventDefault();
    if (target !== undefined) select(target);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(styles.group, styles[size], styles[tone], mono && styles.mono)}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={option.icon ? option.label : undefined}
          title={option.title}
          disabled={option.disabled}
          tabIndex={index === tabStop ? 0 : -1}
          className={cx(styles.option, option.icon !== undefined && styles.icon)}
          onClick={() => {
            select(index);
          }}
          onKeyDown={(event) => {
            onKeyDown(event, index);
          }}
        >
          {option.icon ?? option.label}
        </button>
      ))}
    </div>
  );
}
