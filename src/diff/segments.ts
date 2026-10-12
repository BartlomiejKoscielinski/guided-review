import type { Emphasis } from '../ipc/types/Emphasis';
import type { Token } from './highlight-protocol';

/** A run of text with one syntax color and one emphasis state. */
export interface Segment {
  text: string;
  /** `var(--shiki-…)`, or undefined for plain text. */
  color?: string;
  emphasized: boolean;
}

/**
 * Splits a line into segments at syntax-token and emphasis boundaries (offsets in UTF-16 code
 * units, like JavaScript strings and the core's `Emphasis`).
 */
export function segments(
  text: string,
  tokens: Token[] | undefined,
  emphasis: Emphasis[],
): Segment[] {
  const cuts = new Set<number>([0, text.length]);
  const colors: { start: number; end: number; color: string }[] = [];
  if (tokens && tokens.map((t) => t.text).join('') === text) {
    let at = 0;
    for (const token of tokens) {
      colors.push({ start: at, end: at + token.text.length, color: token.color });
      cuts.add(at);
      at += token.text.length;
      cuts.add(at);
    }
  }
  for (const e of emphasis) {
    cuts.add(Math.min(e.start, text.length));
    cuts.add(Math.min(e.end, text.length));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i] ?? 0;
    const end = points[i + 1] ?? 0;
    if (end <= start) continue;
    const color = colors.find((c) => c.start <= start && start < c.end)?.color;
    const emphasized = emphasis.some((e) => e.start <= start && start < e.end);
    const last = out.at(-1);
    if (last && last.color === color && last.emphasized === emphasized) {
      last.text += text.slice(start, end);
    } else {
      out.push({ text: text.slice(start, end), color, emphasized });
    }
  }
  return out;
}
