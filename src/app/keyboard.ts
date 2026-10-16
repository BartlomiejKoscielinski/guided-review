import { useEffect } from 'react';
import { useMatches, useNavigate } from 'react-router';
import { layoutShortcut, useFocusStore } from '../state/focus';
import { useStartStore } from '../state/start';
import { pathFor, SETTINGS_ROUTE, SHORTCUTS_SETTINGS_ROUTE } from './routes';
import { useModeSwitch } from './useModeSwitch';

/** Ctrl+, without Alt (so AltGr chords on Polish keyboards don't trigger it). */
export function isSettingsShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey && !event.altKey && !event.metaKey && event.key === ',';
}

/** Ctrl+K without Alt or Shift: S-01 with the input focused (F-01.4). */
export function isSourceShortcut(event: KeyboardEvent): boolean {
  return (
    event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.metaKey &&
    event.key.toLowerCase() === 'k'
  );
}

/** Ctrl+D without Alt or Shift: Focus | Detailed on S-03 and S-04 (F-08.1). */
export function isModeShortcut(event: KeyboardEvent): boolean {
  return (
    event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.metaKey &&
    event.key.toLowerCase() === 'd'
  );
}

/**
 * Focus in a field or on a control, where Enter and Space type or press: the single-key
 * shortcuts (Enter on S-02, Space on S-03) leave the key to it.
 */
export function isTypingOrControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a, input, textarea, select') !== null;
}

/** Inputs where a printable key types nothing: a click on one leaves the focus there. */
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/**
 * Focus in a field, where a printable key types: `N`, `C` and `A` leave the key to it. Buttons,
 * checkboxes, radios and other inputs that type nothing don't (a ticked check keeps the focus).
 */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return target.closest('textarea, select') !== null;
}

/** Widgets whose own arrow keys move inside them (WAI-ARIA), and inputs that take the arrows. */
const ARROW_WIDGETS = [
  '[role="menu"]',
  '[role="menubar"]',
  '[role="listbox"]',
  '[role="radiogroup"]',
  '[role="tablist"]',
  '[role="tree"]',
  '[role="grid"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="combobox"]',
  'select',
  'input[type="radio"]',
  'input[type="range"]',
].join(', ');

/**
 * Focus where the arrow keys already mean something: a text field, a menu, a list box, a radio
 * group or segmented control, a select (M4 decision 15). The review walk leaves them the keys;
 * on a plain button or checkbox the arrows still walk.
 */
export function isArrowWidget(target: EventTarget | null): boolean {
  if (isTyping(target)) return true;
  return target instanceof Element && target.closest(ARROW_WIDGETS) !== null;
}

/**
 * `]` without Ctrl, Alt or Meta (AltGr, Ctrl+Alt on Windows, still counts, since some layouts
 * type `]` with it). The key no longer moves between steps (F-30.6, M4 decision 15: `↓`/`↑` walk
 * the review); kept for a layout check of printable keys.
 */
export function isNextStepShortcut(event: KeyboardEvent): boolean {
  return isPrintable(event, ']');
}

/** `[` as `]`; no longer a shortcut (M4 decision 15). */
export function isPrevStepShortcut(event: KeyboardEvent): boolean {
  return isPrintable(event, '[');
}

/** `?` as `]` (Shift types it on most layouts): every shortcut, Settings › Shortcuts (F-30.6). */
export function isAllShortcutsShortcut(event: KeyboardEvent): boolean {
  return isPrintable(event, '?');
}

/** A printable key without Ctrl, Alt or Meta; AltGr (Ctrl+Alt on Windows) still counts. */
function isPrintable(event: KeyboardEvent, key: string): boolean {
  const altGr = event.getModifierState('AltGraph');
  return event.key === key && !event.metaKey && (altGr || (!event.ctrlKey && !event.altKey));
}

/** Ctrl+Shift+O without Alt: Open in Rider at the current line (F-24.1, F-30.6). */
export function isRiderShortcut(event: KeyboardEvent): boolean {
  return (
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    event.key.toLowerCase() === 'o'
  );
}

/** Space without modifiers: Mark reviewed or its undo on S-03 (F-07.2, F-30.6). */
export function isMarkReviewedShortcut(event: KeyboardEvent): boolean {
  return event.key === ' ' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
}

/**
 * App-wide shortcuts that work on every screen (F-30.6 › App group). `Ctrl+,` opens
 * Settings (F-19.4), `Ctrl+K` the S-01 input (F-01.4); `Ctrl+D` Focus | Detailed on S-03 and
 * S-04 (F-08.1), also from a text field; `Ctrl+1/2/3` the Focus layouts on S-03 (F-07.1); `?`
 * Settings › Shortcuts (F-19.3), except in a text field, where it types. The review keys live on
 * their screens (`step/useArrowWalk.ts`, `step/useReviewKeys.ts`, `step/useFileMarks.ts`,
 * `useRiderKey.ts`).
 */
export function useGlobalShortcuts(): void {
  const navigate = useNavigate();
  const requestFocus = useStartStore((s) => s.requestFocus);
  const setLayout = useFocusStore((s) => s.setLayout);
  const toggleMode = useModeSwitch()?.toggle;
  const handle = useMatches().at(-1)?.handle;
  const onStep =
    typeof handle === 'object' && handle !== null && 'screen' in handle && handle.screen === 'S-03';
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isSettingsShortcut(event)) {
        event.preventDefault();
        void navigate(pathFor(SETTINGS_ROUTE));
      } else if (isSourceShortcut(event)) {
        event.preventDefault();
        requestFocus();
        void navigate(pathFor({ screen: 'S-01' }));
      } else if (toggleMode && isModeShortcut(event)) {
        event.preventDefault();
        toggleMode();
      } else if (isAllShortcutsShortcut(event)) {
        if (event.defaultPrevented || isTyping(event.target)) return;
        event.preventDefault();
        void navigate(pathFor(SHORTCUTS_SETTINGS_ROUTE));
      } else if (onStep) {
        // Ctrl+1/2/3 switch the Focus layout on S-03 (F-07.1).
        const layout = layoutShortcut(event);
        if (layout) {
          event.preventDefault();
          setLayout(layout);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [navigate, requestFocus, setLayout, onStep, toggleMode]);
}
