import type { Draft } from '../../ipc/types/Draft';

/** "file:line" of a note kept on a line of the diff; `null` for a comment on the whole change. */
export function draftLocation(draft: Pick<Draft, 'position'>): string | null {
  const { position } = draft;
  return position ? `${position.file}:${String(position.line)}` : null;
}

/** "All 6 steps reviewed." or "4 of 6 steps reviewed." (F-17.4); one step is singular. */
export function progressLine(reviewed: number, total: number): string {
  const steps = total === 1 ? 'step' : 'steps';
  return reviewed >= total
    ? `All ${String(total)} ${steps} reviewed.`
    : `${String(reviewed)} of ${String(total)} ${steps} reviewed.`;
}

/**
 * The kept notes as a Markdown checklist (F-17.4), one "- [ ]" line per note in the order they
 * were made, with "(file:line)" when the note sits on a line. A note's own line breaks become
 * spaces so that every note stays on one line.
 */
export function checklistText(drafts: readonly Draft[]): string {
  return drafts
    .map((draft) => {
      const body = draft.body.replace(/\s*\r?\n\s*/g, ' ').trim();
      const location = draftLocation(draft);
      return location ? `- [ ] ${body} (${location})` : `- [ ] ${body}`;
    })
    .join('\n');
}
