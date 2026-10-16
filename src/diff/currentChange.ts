import type { VirtualItem } from '@tanstack/react-virtual';

// The current change of the arrow-key walk (F-30.6, M4 decisions 14 and 15): the diff that shows
// it scrolls it to the top of the screen and pages through it when it is taller than the screen.
// Positions are measured on screen (client coordinates) at the moment they are needed, so a
// column whose content above the diff changed height (notes, earlier files) still lands exactly.

/** A diff row's or a change's top and bottom on screen. */
export interface Box {
  top: number;
  bottom: number;
}

/** One line of the diff: a screen scroll keeps it from the last screen, and less is no screen. */
const LINE = 22;

/** Scrolls a screen through the current change; false when nothing was left to scroll. */
export type ChangePager = (direction: 1 | -1) => boolean;

let active: { path: string; hunk: string; page: ChangePager } | null = null;

/** The diff showing the current change answers `pageChange` for it until the returned cleanup. */
export function registerPager(path: string, hunk: string, page: ChangePager): () => void {
  const entry = { path, hunk, page };
  active = entry;
  return () => {
    if (active === entry) active = null;
  };
}

/**
 * Scrolls a screen through the change (`hunk` of `path`) when it reaches past the screen in
 * `direction`, or back to it when it is off screen that way; false when it is shown to its end
 * that way (or no diff shows it), so the walk goes on.
 */
export function pageChange(path: string, hunk: string, direction: 1 | -1): boolean {
  return active?.path === path && active.hunk === hunk ? active.page(direction) : false;
}

/** Scrolls `root` to `top` at once (whatever CSS says); without `scrollTo` (jsdom) it sets it. */
export function scrollRootTo(root: HTMLElement, top: number): void {
  const target = Math.max(0, Math.round(top));
  const element: { scrollTo?: (options: ScrollToOptions) => void } = root;
  if (element.scrollTo) element.scrollTo({ top: target, behavior: 'instant' });
  else root.scrollTop = target;
}

/** The part of `root` the reader sees, under a sticky bar of `stickyTop` pixels (S-04's file bar). */
export function screenOf(root: HTMLElement, stickyTop: number): Box {
  const top = root.getBoundingClientRect().top;
  return { top: top + stickyTop, bottom: top + root.clientHeight };
}

/** Scrolls `root` so that `top` (on screen) sits at the top of the screen. */
export function alignTop(root: HTMLElement, stickyTop: number, top: number): void {
  scrollRootTo(root, root.scrollTop + top - screenOf(root, stickyTop).top);
}

/**
 * Where row `index` of a virtual list is on screen: a drawn row's own box; else the nearest drawn
 * row's box moved by the sizes in between (estimated for rows never drawn); else the list's top
 * moved by the row's offset in it. Null without a layout to measure (jsdom).
 */
export function rowBox(
  list: HTMLElement,
  items: readonly VirtualItem[],
  index: number,
  scrollMargin: number,
): Box | null {
  const item = items[index];
  if (!item) return null;
  let anchor: { index: number; element: Element } | null = null;
  for (const element of Array.from(list.children)) {
    const at = element.getAttribute('data-index');
    if (at === null) continue;
    const i = Number(at);
    if (anchor === null || Math.abs(i - index) < Math.abs(anchor.index - index)) {
      anchor = { index: i, element };
    }
  }
  const from = anchor ? items[anchor.index] : undefined;
  const box = (anchor ? anchor.element : list).getBoundingClientRect();
  // Rows the virtualizer gave a size but the page draws without height: nothing is laid out
  // (jsdom), so there is no position to tell.
  if (box.height === 0 && (from ?? item).size > 0) return null;
  if (anchor?.index === index) return { top: box.top, bottom: box.bottom };
  const top = from ? box.top + item.start - from.start : box.top + item.start - scrollMargin;
  return { top, bottom: top + item.size };
}

/**
 * A screen through `change` in `direction` (M4 decision 15): a change below the screen (`↓`) or
 * above it (`↑`) is brought back to the top; one that reaches past the screen's edge scrolls by
 * a screen, at most to its end. False when the change is shown to its end that way, or when the
 * screen is too small to page (no layout).
 */
export function pageThrough(
  root: HTMLElement,
  stickyTop: number,
  change: Box,
  direction: 1 | -1,
): boolean {
  const screen = screenOf(root, stickyTop);
  const height = screen.bottom - screen.top;
  if (height < 2 * LINE) return false;
  const before = root.scrollTop;
  const off = direction > 0 ? change.top > screen.bottom : change.bottom < screen.top;
  if (off) {
    alignTop(root, stickyTop, change.top);
    return root.scrollTop !== before;
  }
  const left = direction > 0 ? change.bottom - screen.bottom : screen.top - change.top;
  if (left <= 1) return false;
  scrollRootTo(root, before + direction * Math.min(left, height - LINE));
  return root.scrollTop !== before;
}

/** Scrolls `root` the least that shows all of `element` (or its top, when it is taller). */
export function bringIntoView(root: HTMLElement, element: Element): void {
  const screen = screenOf(root, 0);
  const box = element.getBoundingClientRect();
  if (box.top < screen.top || box.bottom - box.top > screen.bottom - screen.top) {
    alignTop(root, 0, box.top);
  } else if (box.bottom > screen.bottom) {
    scrollRootTo(root, root.scrollTop + box.bottom - screen.bottom);
  }
}
