#!/usr/bin/env node
// Appends one item attempt to .metrics/items.jsonl from its verdict files (AUTOPILOT.md §4 B7).
//   node tools/autopilot/record.mjs F-07.2 --run ap-20261014-1200 --result done|partial|blocked|needs-owner
//        [--dir .autopilot/items/F-07.2] [--started <iso>]
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRow } from './items-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? fallback : (argv[i + 1] ?? fallback);
};
const item = argv[0];
const result = flag('result');
if (!item || !flag('run') || !['done', 'partial', 'blocked', 'needs-owner'].includes(result)) {
  console.error('usage: record.mjs <item> --run <runId> --result done|partial|blocked|needs-owner');
  process.exit(2);
}
const dir = resolve(root, flag('dir', join('.autopilot', 'items', item)));
const verdicts = {};
if (existsSync(dir)) {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    try {
      verdicts[basename(f, '.json')] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {
      /* a broken verdict counts as missing */
    }
  }
}
const row = buildRow({
  item,
  run: flag('run'),
  result,
  verdicts,
  startedAt: flag('started'),
  endedAt: new Date().toISOString(),
});
mkdirSync(join(root, '.metrics'), { recursive: true });
appendFileSync(join(root, '.metrics', 'items.jsonl'), `${JSON.stringify(row)}\n`);
console.log(JSON.stringify(row));
