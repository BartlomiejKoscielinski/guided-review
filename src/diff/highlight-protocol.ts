import type { Language } from './language';

/** A highlighted piece of a line; `color` is a `var(--shiki-…)` reference. */
export interface Token {
  text: string;
  color: string;
}

export interface HighlightRequest {
  id: number;
  lang: Language;
  /** Blocks of consecutive lines (one per hunk side). */
  blocks: string[][];
}

export interface HighlightResponse {
  id: number;
  /** Per block, per line, the tokens. */
  blocks?: Token[][][];
  error?: string;
}
