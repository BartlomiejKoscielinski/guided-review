#!/usr/bin/env node
// Autopilot backlog CLI (docs/process/AUTOPILOT.md §3.1). Writes docs/process/backlog.json and
// docs/process/DECISIONS-PENDING.md of this checkout; the conductor commits them.
//   node tools/autopilot/backlog.mjs sync --milestone M3
//   node tools/autopilot/backlog.mjs next                      → JSON item or {"none": reason}
//   node tools/autopilot/backlog.mjs set F-07.2 impl [--note t] [--attempt] [--lock sha --tests a,b] [--kind ui]
//   node tools/autopilot/backlog.mjs set F-07.2 --dispute tests/e2e/x.spec.ts@abc1234   (gate.mjs applies it from then on)
//   node tools/autopilot/backlog.mjs list
//   node tools/autopilot/backlog.mjs decision '<json: item, decisions: [{question, chosen, alternatives, reversible}]>'
//     (all decisions of one item at once, each with a "why"; one decided row per item)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDecisions, next, setItem, sync } from './backlog-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKLOG = join(root, 'docs', 'process', 'backlog.json');
const DECISIONS = join(root, 'docs', 'process', 'DECISIONS-PENDING.md');
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const now = () => new Date().toISOString();

const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const key = rest[i].slice(2);
    const value = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
    flags[key] = value;
  } else positional.push(rest[i]);
}

const loadBacklog = () => {
  const text = read(BACKLOG);
  if (!text) throw new Error('no docs/process/backlog.json: run sync --milestone Mx first');
  return JSON.parse(text);
};
const save = (backlog) => writeFileSync(BACKLOG, `${JSON.stringify(backlog, null, 2)}\n`);

try {
  if (cmd === 'sync') {
    const previous = read(BACKLOG) ? JSON.parse(read(BACKLOG)) : null;
    const milestone = String(flags.milestone ?? previous?.milestone ?? '').toUpperCase();
    if (!/^M\d+$/.test(milestone)) throw new Error('--milestone Mx');
    const planPath = join(root, 'docs', 'plans', `${milestone}.md`);
    const backlog = sync({
      progressMd: read(join(root, 'docs', 'PROGRESS.md')),
      planMd: read(planPath),
      decisionsMd: read(DECISIONS),
      milestone,
      previous: previous?.milestone === milestone ? previous : null,
      now: now(),
    });
    save(backlog);
    const open = backlog.items.filter((i) => i.status !== 'done').length;
    console.log(
      `${milestone}: ${backlog.items.length} items, ${open} open → docs/process/backlog.json`,
    );
  } else if (cmd === 'next') {
    console.log(JSON.stringify(next(loadBacklog())));
  } else if (cmd === 'set') {
    const [id, status] = positional;
    const backlog = loadBacklog();
    const item = setItem(
      backlog,
      id,
      {
        status,
        note: typeof flags.note === 'string' ? flags.note : undefined,
        attempt: flags.attempt === true,
        lockSha: typeof flags.lock === 'string' ? flags.lock : undefined,
        tests: typeof flags.tests === 'string' ? flags.tests.split(',').filter(Boolean) : undefined,
        kind: typeof flags.kind === 'string' ? flags.kind : undefined,
        dispute: typeof flags.dispute === 'string' ? flags.dispute : undefined,
      },
      now(),
    );
    save(backlog);
    console.log(JSON.stringify(item));
  } else if (cmd === 'list') {
    for (const i of loadBacklog().items) {
      console.log(
        `${i.status.padEnd(11)} ${i.id.padEnd(8)} ${i.kind.padEnd(5)} ${i.title.slice(0, 70)}`,
      );
    }
  } else if (cmd === 'decision') {
    const d = JSON.parse(positional[0] ?? '{}');
    const base = read(DECISIONS);
    if (!base) throw new Error('no docs/process/DECISIONS-PENDING.md');
    const out = addDecisions(base, { ...d, date: now().slice(0, 10) });
    if (out.added) writeFileSync(DECISIONS, out.md);
    console.log(
      out.added
        ? `${out.id} ${out.appended ? 'appended' : 'new'}: ${out.added} point(s)`
        : 'no new decisions',
    );
  } else {
    console.error('usage: backlog.mjs sync|next|set|list|decision (see the header)');
    process.exit(2);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
