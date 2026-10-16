import { Button, type ButtonSize } from '../../components/Button';
import { CheckIcon } from '../../components/icons';

export interface FileReviewedProps {
  /** The file's path in the step: the toggle is named after it. */
  path: string;
  reviewed: boolean;
  onToggle: () => void;
  size?: ButtonSize;
  className?: string;
}

/**
 * A file's **Reviewed** toggle (F-07.10) in the S-03 file header and the S-04 sticky file bar:
 * pressed = green fill. Its visible text stays "Reviewed"; assistive technology hears
 * "Mark <path> reviewed" and the pressed state.
 */
export function FileReviewed({
  path,
  reviewed,
  onToggle,
  size = 28,
  className,
}: FileReviewedProps) {
  return (
    <Button
      size={size}
      variant={reviewed ? 'approve' : 'neutral'}
      className={className}
      aria-pressed={reviewed}
      aria-label={`Mark ${path} reviewed`}
      onClick={onToggle}
    >
      <CheckIcon size={13} strokeWidth={2.6} />
      Reviewed
    </Button>
  );
}
