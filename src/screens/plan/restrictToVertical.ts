import type { Modifier } from '@dnd-kit/core';

/** Rows move only up and down (without the extra `@dnd-kit/modifiers` package). */
export const restrictToVertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });
