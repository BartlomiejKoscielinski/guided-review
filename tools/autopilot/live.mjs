#!/usr/bin/env node
// Autopilot live checks (docs/process/AUTOPILOT.md §5, autopilot SKILL "Closing"): the conductor's
// verdict on a criterion the live role checked in the real app. Writes docs/PROGRESS.md and
// docs/process/backlog.json of this checkout; the conductor commits them.
//   node tools/autopilot/live.mjs pass F-09.6                  → PROGRESS line ticked with the SHAs of its note, item done
//   node tools/autopilot/live.mjs fail F-09.6 --note "<what>"  → item todo with "live check failed: …", the loop fixes it
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { liveTick, setItem } from './backlog-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKLOG = join(root, 'docs', 'process', 'backlog.json');
const PROGRESS = join(root, 'docs', 'PROGRESS.md');
const [cmd, id, ...rest] = process.argv.slice(2);
const noteAt = rest.indexOf('--note');
const note = noteAt < 0 ? undefined : rest[noteAt + 1];

try {
  if (!['pass', 'fail'].includes(cmd) || !id) {
    console.error(
      'usage: live.mjs pass <id> | fail <id> --note "<what is wrong>" (see the header)',
    );
    process.exit(2);
  }
  const backlog = JSON.parse(readFileSync(BACKLOG, 'utf8'));
  const status = backlog.items.find((i) => i.id === id)?.status;
  if (status !== 'live') throw new Error(`${id} does not wait for a live check (status ${status})`);
  const now = new Date().toISOString();
  if (cmd === 'pass') {
    writeFileSync(PROGRESS, liveTick(readFileSync(PROGRESS, 'utf8'), id));
    setItem(backlog, id, { status: 'done' }, now);
  } else {
    if (!note) throw new Error('fail needs --note "<what is wrong>"');
    setItem(backlog, id, { status: 'todo', note: `live check failed: ${note}` }, now);
  }
  writeFileSync(BACKLOG, `${JSON.stringify(backlog, null, 2)}\n`);
  console.log(`${id}: ${cmd === 'pass' ? 'done, PROGRESS ticked' : 'todo, live check failed'}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
