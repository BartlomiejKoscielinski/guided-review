import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCROLL_SAVE_MS, useStepScroll } from './useStepScroll';

/** A `main` whose scroll position can be set (jsdom lays nothing out). */
function fakeMain() {
  const el = document.createElement('main');
  let top = 0;
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value;
    },
  });
  const scrollTo = (value: number) => {
    top = value;
    el.dispatchEvent(new Event('scroll'));
  };
  return { ref: { current: el }, scrollTo };
}

describe('useStepScroll (F-04.3)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('F-04.3 the step opens where it was scrolled once the step and its notes are shown', () => {
    vi.useFakeTimers();
    const { ref } = fakeMain();
    const save = vi.fn();
    const { rerender } = renderHook(
      ({ ready }) => {
        useStepScroll(ref, ready, 245, save);
      },
      {
        initialProps: { ready: false },
      },
    );
    vi.advanceTimersToNextFrame();
    expect(ref.current.scrollTop).toBe(0);
    rerender({ ready: true });
    // In the frame after the step is drawn, once the diff's virtualizers are attached.
    vi.advanceTimersToNextFrame();
    expect(ref.current.scrollTop).toBe(245);
    vi.advanceTimersByTime(SCROLL_SAVE_MS);
    expect(save).not.toHaveBeenCalled();
  });

  it('F-04.3 a position is written when scrolling pauses, a pending one when the step closes', () => {
    vi.useFakeTimers();
    const { ref, scrollTo } = fakeMain();
    const save = vi.fn();
    const { unmount } = renderHook(() => {
      useStepScroll(ref, true, 0, save);
    });
    vi.advanceTimersToNextFrame();
    scrollTo(100);
    scrollTo(120);
    vi.advanceTimersByTime(SCROLL_SAVE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save.mock.calls).toEqual([[120]]);
    scrollTo(300);
    unmount();
    expect(save.mock.calls).toEqual([[120], [300]]);
  });

  it('F-04.3 a reader who scrolls before the step is ready keeps their position', () => {
    vi.useFakeTimers();
    const { ref, scrollTo } = fakeMain();
    const save = vi.fn();
    const { rerender } = renderHook(
      ({ ready }) => {
        useStepScroll(ref, ready, 245, save);
      },
      {
        initialProps: { ready: false },
      },
    );
    scrollTo(80);
    rerender({ ready: true });
    vi.advanceTimersToNextFrame();
    expect(ref.current.scrollTop).toBe(80);
    vi.advanceTimersByTime(SCROLL_SAVE_MS);
    expect(save.mock.calls).toEqual([[80]]);
  });
});
