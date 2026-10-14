#!/usr/bin/env node
// Appends one item attempt to .metrics/items.jsonl from its verdict files (AUTOPILOT.md §4 B7).
//   node tools/autopilot/record.mjs F-07.2 --run ap-20261014-1200 --result done|partial|blocked|needs-owner
//        [--dir .autopilot/items/F-07.2] [--started <iso>] [--session <id>] [--out .metrics/items.jsonl]
// Tokens per role come from the role subagents' transcripts of the conductor session (--session,
// default $CLAUDE_CODE_SESSION_ID; Agent descriptions "ap <role> <item>"), else from the verdicts.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRow, roleUsage } from './items-lib.mjs';
import { parseTranscript, projectDirs, readLines, tokenTotals } from '../metrics/transcript.mjs';

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

/** The subagents of the conductor session: [{ description, start, totals }]. */
function sessionSubagents(session) {
  const base = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
  if (!session || !existsSync(base)) return [];
  const out = [];
  for (const { name } of projectDirs(root, readdirSync(base))) {
    const subDir = join(base, name, session, 'subagents');
    if (!existsSync(subDir)) continue;
    for (const f of readdirSync(subDir).filter((x) => x.endsWith('.meta.json'))) {
      const file = join(subDir, f.replace(/\.meta\.json$/, '.jsonl'));
      if (!existsSync(file)) continue;
      try {
        const meta = JSON.parse(readFileSync(join(subDir, f), 'utf8'));
        const p = parseTranscript(readLines(file));
        out.push({ description: meta.description, start: p.start, totals: tokenTotals(p.turns) });
      } catch {
        /* an unreadable transcript counts as missing */
      }
    }
  }
  return out;
}

const startedAt = flag('started');
const usage = roleUsage(
  sessionSubagents(flag('session', process.env.CLAUDE_CODE_SESSION_ID ?? null)),
  { item, since: startedAt },
);
const row = buildRow({
  item,
  run: flag('run'),
  result,
  verdicts,
  startedAt,
  endedAt: new Date().toISOString(),
  usage,
});
const out = resolve(root, flag('out', join('.metrics', 'items.jsonl')));
mkdirSync(dirname(out), { recursive: true });
appendFileSync(out, `${JSON.stringify(row)}\n`);
console.log(JSON.stringify(row));
