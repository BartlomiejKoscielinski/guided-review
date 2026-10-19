import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LogLine } from '../../ipc/types/LogLine';
import { JobLog } from './JobLog';

// jsdom has no layout: give every element a 1000px content in a 200px box and a stored scrollTop.
const HEIGHT = 1000;
const BOX = 200;
const saved = {
  scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight'),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
  scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop'),
};
const tops = new WeakMap<Element, number>();

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => HEIGHT,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => BOX,
  });
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get(this: Element) {
      return tops.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      tops.set(this, value);
    },
  });
});

afterEach(() => {
  for (const [key, target] of [
    ['scrollHeight', HTMLElement.prototype],
    ['clientHeight', HTMLElement.prototype],
    ['scrollTop', Element.prototype],
  ] as const) {
    const descriptor = saved[key];
    if (descriptor) Object.defineProperty(target, key, descriptor);
  }
});

const lines = (from: number, count: number): LogLine[] =>
  Array.from({ length: count }, (_, i) => ({ kind: 'plain', text: `line ${String(from + i)}` }));

describe('job log tail (F-20.5)', () => {
  it('F-20.5 a finished job opens its log at the tail, where the error is', () => {
    render(<JobLog lines={lines(1, 80)} truncated={false} running={false} replaces={1} />);

    expect(screen.getByRole('log').scrollTop).toBe(HEIGHT);
  });

  it('F-20.5 a running log follows new lines until the user scrolls up', () => {
    const view = render(<JobLog lines={lines(1, 80)} truncated={false} running replaces={1} />);
    const log = screen.getByRole('log');
    expect(log.scrollTop).toBe(HEIGHT);

    log.scrollTop = 100;
    fireEvent.scroll(log);
    view.rerender(<JobLog lines={lines(1, 90)} truncated={false} running replaces={1} />);

    expect(log.scrollTop).toBe(100);
  });

  it('F-20.5 a replaced log jumps to the tail again even after the user scrolled up', () => {
    const view = render(
      <JobLog lines={lines(1, 80)} truncated={false} running={false} replaces={1} />,
    );
    const log = screen.getByRole('log');
    log.scrollTop = 100;
    fireEvent.scroll(log);

    view.rerender(<JobLog lines={lines(1, 60)} truncated={false} running={false} replaces={2} />);

    expect(log.scrollTop).toBe(HEIGHT);
  });
});
