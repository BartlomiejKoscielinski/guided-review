import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';
import { useAuthorCommitStore } from '../state/authorCommit';
import { useAuthorQuestionStore } from '../state/authorQuestion';
import { useFixStore } from '../state/fix';
import { useReviewStore } from '../state/review';

// Whole-app renders (S-01 with three columns) can take over 1 s under full-suite load.
configure({ asyncUtilTimeout: 3000 });

afterEach(() => {
  cleanup();
  // The step state outlives a screen (F-08.1); each test starts without one.
  useReviewStore.getState().reset();
  // The open fix outlives a screen too (F-25.3).
  useFixStore.getState().reset();
  // S-10's commit panels outlive the thread view (F-26.4).
  useAuthorCommitStore.getState().reset();
  // ...and so do the question composers (F-26.7).
  useAuthorQuestionStore.getState().reset();
});

// jsdom has no ResizeObserver; TanStack Virtual only needs it to exist (sizes stay 0 there).
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub });
}
