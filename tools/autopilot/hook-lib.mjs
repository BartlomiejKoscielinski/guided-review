// Autopilot Stop hook logic (docs/process/AUTOPILOT.md §4 B3): keeps the conductor going while
// there is ready work, budget and iterations left. Pure; I/O in stop-hook.mjs.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

const TAIL_BYTES = 400_000;

/** The last lines of a transcript (JSONL), newest last; a partial first line is dropped by the parser. */
export function transcriptTail(file) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8').split('\n');
  } finally {
    closeSync(fd);
  }
}

/** Text of the newest assistant message that has text (tool-only messages are skipped). */
export function lastAssistantText(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!l.includes('"assistant"')) continue;
    try {
      const entry = JSON.parse(l);
      if (entry.type !== 'assistant') continue;
      const content = entry.message?.content;
      const text = Array.isArray(content)
        ? content
            .filter((c) => c?.type === 'text')
            .map((c) => c.text)
            .join('\n')
        : typeof content === 'string'
          ? content
          : '';
      if (text.trim()) return text;
    } catch {
      /* partial first line */
    }
  }
  return '';
}

export const marker = (runId) => `AUTOPILOT ${runId}`;

/**
 * Whether to block the conductor's stop. Returns `{ block, reason, run }` with the run state to
 * save (iterations counted on each continuation; `finalized` once the closing turn was asked for).
 * The skill starts the first item itself, so a run has done `iterations + 1` items and `--cap N`
 * means N items.
 */
export function decide({ run, text, stopFile, spentTokens, nextItem }) {
  if (!run) return { block: false, reason: 'no autopilot run' };
  const m = marker(run.runId);
  if (!text.includes(m)) return { block: false, reason: 'not the conductor' };
  if (text.includes(`${m} stop`)) return { block: false, reason: 'the conductor stopped' };
  let ending = null;
  if (stopFile) ending = 'the owner asked to stop (.autopilot/STOP)';
  else if (run.iterations + 1 >= run.cap) ending = `iteration cap ${run.cap} reached`;
  else if (run.budgetTokens && spentTokens >= run.budgetTokens)
    ending = `token budget ${run.budgetTokens} spent (${spentTokens})`;
  else if (nextItem?.none) ending = nextItem.none;
  if (ending) {
    if (run.finalized) return { block: false, reason: ending };
    return {
      block: true,
      run: { ...run, finalized: true },
      reason: `Autopilot ${run.runId} ends: ${ending}. Do "Closing" of .claude/skills/autopilot/SKILL.md (summary, notification), then end with "${m} stop: ${ending}".`,
    };
  }
  const iterations = run.iterations + 1;
  return {
    block: true,
    run: { ...run, iterations },
    reason: `Autopilot ${run.runId}: next item ${nextItem.id} (${nextItem.status}), iteration ${iterations + 1}/${run.cap}. Follow "Loop body" of .claude/skills/autopilot/SKILL.md; end the turn with "${m} next".`,
  };
}

/** Tokens the run spent so far: the `tokens.total` of its rows in .metrics/items.jsonl. */
export function spentByRun(itemsJsonl, runId) {
  let sum = 0;
  for (const line of itemsJsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.run === runId) sum += Number(row.tokens?.total ?? 0);
    } catch {
      /* skip */
    }
  }
  return sum;
}
