#!/usr/bin/env node
// Outcome metrics of the autopilot (.metrics/items.jsonl; AUTOPILOT.md §4 B7).
//   node tools/autopilot/judge.mjs --metric tokens --since 2026-10-14T12:00:00Z [--k 5]  → keep | revert | wait
//   node tools/autopilot/judge.mjs --summary [--run ap-20261014-1200]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge, parseRows, summary } from './items-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const file = join(root, '.metrics', 'items.jsonl');
const rows = parseRows(existsSync(file) ? readFileSync(file, 'utf8') : '');
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? null : (argv[i + 1] ?? null);
};

try {
  if (argv.includes('--summary')) {
    console.log(JSON.stringify(summary(rows, flag('run'))));
  } else if (flag('metric') && flag('since')) {
    console.log(
      JSON.stringify(
        judge(rows, { metric: flag('metric'), since: flag('since'), k: Number(flag('k') ?? 5) }),
      ),
    );
  } else {
    console.error('usage: judge.mjs --metric <m> --since <iso> [--k 5] | --summary [--run id]');
    process.exit(2);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
