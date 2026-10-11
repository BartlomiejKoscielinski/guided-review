import type { ReactNode } from 'react';

// Inline SVG icons with the paths from docs/design/mocks (docs/03-design-system.md › Icons).
// They draw with currentColor, square line caps, and are hidden from assistive technology:
// the control that contains an icon carries the label.

export interface IconProps {
  /** Rendered width and height in px. */
  size?: number;
  /** Overrides the icon's default stroke width. */
  strokeWidth?: number;
  className?: string;
}

interface SvgProps extends IconProps {
  viewBox: string;
  defaultSize: number;
  defaultStroke?: number;
  filled?: boolean;
  /** Width/height ratio for non-square icons (layout switcher). */
  aspect?: number;
  /** The caption and layout glyphs in the mocks use butt caps. */
  cap?: 'square' | 'butt';
  children: ReactNode;
}

function Svg({
  viewBox,
  defaultSize,
  defaultStroke,
  filled = false,
  aspect = 1,
  cap = 'square',
  size = defaultSize,
  strokeWidth = defaultStroke,
  className,
  children,
}: SvgProps) {
  return (
    <svg
      width={Math.round(size * aspect)}
      height={size}
      viewBox={viewBox}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? undefined : 'currentColor'}
      strokeWidth={filled ? undefined : strokeWidth}
      strokeLinecap={cap}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** The "H" mark of the logo square and the app icon (ADR-020). */
export function LogoMarkIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" defaultSize={15} defaultStroke={2.2} {...props}>
      <path d="M4 2v12M12 2v12M4 8h8" />
    </Svg>
  );
}

/** Dock: MRs (merge graph). */
export function MergeRequestIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" defaultSize={22} defaultStroke={2} {...props}>
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M6 7.5v9M18 16.5V10a4 4 0 0 0-4-4h-4" />
      <path d="M12 4l-2 2 2 2" />
    </Svg>
  );
}

/** Dock: Review (map pin). */
export function ReviewIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" defaultSize={22} defaultStroke={2} {...props}>
      <path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z" />
      <circle cx="12" cy="10" r="2.2" />
    </Svg>
  );
}

/** Dock: Changes (commit node). */
export function CommitIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" defaultSize={22} defaultStroke={2} {...props}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M2 12h6.5M15.5 12H22" />
    </Svg>
  );
}

/** Dock: Settings (gear). */
export function SettingsIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 24 24" defaultSize={22} defaultStroke={2} {...props}>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </Svg>
  );
}

/** Caption button: Minimize. */
export function MinimizeIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 10 10" defaultSize={10} defaultStroke={1} cap="butt" {...props}>
      <path d="M0 5h10" />
    </Svg>
  );
}

/** Caption button: Maximize. */
export function MaximizeIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 10 10" defaultSize={10} defaultStroke={1} cap="butt" {...props}>
      <rect x="0.5" y="0.5" width="9" height="9" />
    </Svg>
  );
}

/** Caption button: Restore (window is maximized), the Windows two-square glyph. */
export function RestoreIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 10 10" defaultSize={10} defaultStroke={1} cap="butt" {...props}>
      <rect x="0.5" y="2.5" width="7" height="7" />
      <path d="M2.5 2.5v-2h7v7h-2" />
    </Svg>
  );
}

/** Caption button: Close. */
export function CloseIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 10 10" defaultSize={10} defaultStroke={1} cap="butt" {...props}>
      <path d="M0 0l10 10M10 0 0 10" />
    </Svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" defaultSize={11} defaultStroke={2.4} {...props}>
      <path d="M4 6l4 4 4-4" />
    </Svg>
  );
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" defaultSize={14} defaultStroke={1.6} {...props}>
      <path d="M4 10l4-4 4 4" />
    </Svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" defaultSize={16} defaultStroke={2.2} {...props}>
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </Svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" defaultSize={16} defaultStroke={2.2} {...props}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </Svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" defaultSize={16} defaultStroke={2} {...props}>
      <path d="M2 8h11M9.5 4.5 13 8l-3.5 3.5" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" defaultSize={11} defaultStroke={3} {...props}>
      <path d="M3 8.5l3.2 3L13 4.5" />
    </Svg>
  );
}

export function CrossIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" defaultSize={10} defaultStroke={3} {...props}>
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </Svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" defaultSize={12} filled {...props}>
      <path d="M4 2.5v11l9.5-5.5z" />
    </Svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" defaultSize={11} filled {...props}>
      <rect x="3" y="3" width="10" height="10" />
    </Svg>
  );
}

export function RetryIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" defaultSize={14} defaultStroke={2.2} {...props}>
      <path d="M13 8a5 5 0 1 1-1.6-3.7" />
      <path d="M13 2.5V5h-2.5" />
    </Svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" defaultSize={12} defaultStroke={2} {...props}>
      <rect x="3" y="7" width="10" height="7" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" />
    </Svg>
  );
}

export function CommentIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" defaultSize={13} defaultStroke={1.8} {...props}>
      <path d="M2.5 3h11v7.5h-6L4.5 13v-2.5h-2z" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" defaultSize={18} defaultStroke={1.8} {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5l3.5 3.5" />
    </Svg>
  );
}

/** Spinner arc; rotation comes from the caller's CSS (docs/03 › Motion). */
export function SpinnerIcon(props: IconProps) {
  return (
    <Svg viewBox="0 0 16 16" defaultSize={14} defaultStroke={2.4} {...props}>
      <path d="M8 2a6 6 0 1 1-6 6" />
    </Svg>
  );
}

/** Title bar layout switcher: A Sidebar. */
export function LayoutSidebarIcon(props: IconProps) {
  return (
    <Svg
      viewBox="0 0 16 14"
      defaultSize={14}
      defaultStroke={1.6}
      aspect={16 / 14}
      cap="butt"
      {...props}
    >
      <rect x="0.8" y="0.8" width="14.4" height="12.4" />
      <path d="M5.5 0.8v12.4" />
    </Svg>
  );
}

/** Title bar layout switcher: B Minimal. */
export function LayoutMinimalIcon(props: IconProps) {
  return (
    <Svg
      viewBox="0 0 16 14"
      defaultSize={14}
      defaultStroke={1.6}
      aspect={16 / 14}
      cap="butt"
      {...props}
    >
      <rect x="0.8" y="0.8" width="14.4" height="12.4" />
      <path d="M5 10h6" />
    </Svg>
  );
}

/** Title bar layout switcher: C Guide. */
export function LayoutGuideIcon(props: IconProps) {
  return (
    <Svg
      viewBox="0 0 16 14"
      defaultSize={14}
      defaultStroke={1.6}
      aspect={16 / 14}
      cap="butt"
      {...props}
    >
      <rect x="0.8" y="0.8" width="14.4" height="12.4" />
      <path d="M10.5 0.8v12.4" />
    </Svg>
  );
}
