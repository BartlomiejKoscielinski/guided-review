#!/usr/bin/env node
// Stop hook (.claude/settings.json): the autopilot loop (docs/process/AUTOPILOT.md §3). Only the
// conductor of the active run (marker "AUTOPILOT <runId>" in its last message) is kept going;
// every other session stops as usual. Stdin: the hook input JSON. Never fails the stop.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { next } from './backlog-lib.mjs';
import { decide, lastAssistantText, spentByRun, transcriptTail } from './hook-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

try {
  const runPath = join(root, '.autopilot', 'run.json');
  if (!existsSync(runPath)) process.exit(0);
  const input = JSON.parse(readFileSync(0, 'utf8'));
  if (input.agent_id || !input.transcript_path || !existsSync(input.transcript_path))
    process.exit(0);
  const run = JSON.parse(readFileSync(runPath, 'utf8'));
  const backlogText = read(join(root, 'docs', 'process', 'backlog.json'));
  const result = decide({
    run,
    text: lastAssistantText(transcriptTail(input.transcript_path)),
    stopFile: existsSync(join(root, '.autopilot', 'STOP')),
    spentTokens: spentByRun(read(join(root, '.metrics', 'items.jsonl')), run.runId),
    nextItem: backlogText ? next(JSON.parse(backlogText)) : { none: 'no backlog' },
  });
  if (!result.block) process.exit(0);
  writeFileSync(runPath, `${JSON.stringify(result.run, null, 2)}\n`);
  console.log(JSON.stringify({ decision: 'block', reason: result.reason }));
} catch {
  /* the hook never blocks by accident */
}
process.exit(0);
