#!/usr/bin/env node
// Process feedback loop: where sessions spend tokens and time. Ingests this project's Claude Code
// transcripts (worktrees too) into .metrics/sessions.jsonl and prints a compact report.
//
//   node tools/metrics/report.mjs                     the current (latest) session, brief
//   node tools/metrics/report.mjs --session <id|title part>
//   node tools/metrics/report.mjs --last 8            table + cross-session patterns + suggestions
//   node tools/metrics/report.mjs --retro-due         sessions since the last /retro
//
// Numbers: tokens per turn come from the API usage in the transcript; tool-result sizes are
// estimated (chars / 3.5, images 1600). "Tax" = result tokens × the turns after it that re-read
// it as cache, i.e. what a big result really cost.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectDirs, sessionRecord } from './transcript.mjs';
import { crossSuggestions, retroStatus, sessionSuggestions, skillCosts } from './suggest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ledgerFile = join(root, '.metrics', 'sessions.jsonl');
const improvements = join(root, 'docs', 'process', 'IMPROVEMENTS.md');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] ?? '') : null;
};

const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);
const min = (ms) => `${(ms / 60000).toFixed(1)}m`;
const day = (iso) => (iso ?? '').slice(0, 10);
// Lane sessions (tools/lanes.mjs) are prefixed with their lane.
const label = (r) => `${r.lane ? `[${r.lane}] ` : ''}${r.title ?? r.id}`;

/** Transcript folders of this repo: the checkout, worktrees under it and lanes next to it. */
function transcriptDirs() {
  const base = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
  if (!existsSync(base)) return [];
  return projectDirs(root, readdirSync(base)).map((d) => ({
    dir: join(base, d.name),
    lane: d.lane,
  }));
}

function loadLedger() {
  if (!existsSync(ledgerFile)) return new Map();
  const rows = readFileSync(ledgerFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Re-parses transcripts that changed since they were recorded; keeps records of deleted ones. */
function ingest() {
  const ledger = loadLedger();
  let changed = 0;
  for (const { dir, lane } of transcriptDirs()) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
      const file = join(dir, f);
      const subDir = join(dir, f.replace(/\.jsonl$/, ''), 'subagents');
      const mtime = Math.max(
        statSync(file).mtimeMs,
        existsSync(subDir) ? statSync(subDir).mtimeMs : 0,
      );
      const id = f.replace(/\.jsonl$/, '');
      if (ledger.get(id)?.mtime === mtime) continue;
      const r = sessionRecord(file);
      if (!r.main.turns) continue;
      // ../gr-<name> is a lane only when the session ran on a lane branch (mN/<lane>, tools/lanes.mjs).
      if (lane && !(r.branch ?? '').endsWith(`/${lane}`)) continue;
      ledger.set(id, { ...r, ...(lane ? { lane } : {}), mtime });
      changed++;
    }
  }
  if (changed) {
    mkdirSync(dirname(ledgerFile), { recursive: true });
    const rows = [...ledger.values()].sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
    writeFileSync(ledgerFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  return [...ledger.values()].sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
}

const sub = (r, key) => r.subagents.reduce((n, s) => n + s[key], 0);
const totalRead = (r) => r.main.cacheRead + sub(r, 'cacheRead');

function brief(r) {
  const lines = [];
  lines.push(
    `${label(r)} (${r.branch ?? '?'}) · ${day(r.start)} · ${r.activeMin} min active${r.costUSD ? ` · $${r.costUSD.toFixed(2)} (API-equivalent)` : ''}`,
  );
  lines.push(
    `main: ${r.main.turns} turns · base ${k(r.main.baseContext)} · max ${k(r.main.maxContext)} · cache read ${k(r.main.cacheRead)} (${k(r.main.cacheReadOver150k)} above 150k) · write ${k(r.main.cacheWrite)} · out ${k(r.main.output)}${r.compactions ? ` · ${r.compactions} compactions` : ''}`,
  );
  for (const s of r.subagents)
    lines.push(
      `  ${s.kind}: ${s.turns} turns · ${s.toolCalls} calls · cache read ${k(s.cacheRead)} · ${min(s.activeMs)} · ${s.models.join(',')}`,
    );
  if (r.skills.length) lines.push(`skills: ${r.skills.join(', ')}`);
  lines.push(
    'context tax: ' +
      r.topTax
        .slice(0, 5)
        .map((g) => `${g.label} ${k(g.tax)} (${g.calls}×)`)
        .join(' · '),
  );
  lines.push(
    'time: ' +
      r.topTime
        .slice(0, 4)
        .map((g) => `${g.label} ${min(g.ms)} (${g.calls}×)`)
        .join(' · '),
  );
  const s = sessionSuggestions(r);
  if (s.length) lines.push('suggestions:', ...s.map((x) => `  [${x.rule}] ${x.text}`));
  return lines.join('\n');
}

function verifyTimings() {
  const file = join(root, '.verify', 'timings.jsonl');
  if (!existsSync(file)) return null;
  const by = new Map();
  for (const l of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const t = JSON.parse(l);
    by.set(t.step, [...(by.get(t.step) ?? []), t.secs]);
  }
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return [...by]
    .map(([step, xs]) => `${step} ${median(xs).toFixed(0)}s (${xs.length}×)`)
    .join(' · ');
}

function table(records) {
  const lines = [
    'date       | session                          | act | turns m+s | base | max  | read  | out',
  ];
  for (const r of records)
    lines.push(
      [
        day(r.start),
        label(r).slice(0, 32).padEnd(32),
        String(r.activeMin).padStart(3),
        `${r.main.turns}+${sub(r, 'turns')}`.padStart(9),
        k(r.main.baseContext).padStart(4),
        k(r.main.maxContext).padStart(4),
        k(totalRead(r)).padStart(5),
        k(r.main.output + sub(r, 'output')),
      ].join(' | '),
    );
  return lines.join('\n');
}

function lastReport(records) {
  const out = [table(records), ''];
  const tax = new Map();
  const time = new Map();
  for (const r of records) {
    for (const g of r.topTax) tax.set(g.label, (tax.get(g.label) ?? 0) + g.tax);
    for (const g of r.topTime.filter((g) => !/^AskUserQuestion/.test(g.label)))
      time.set(g.label, (time.get(g.label) ?? 0) + g.ms);
  }
  const sorted = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 6);
  out.push(
    'context tax (sum): ' +
      sorted(tax)
        .map(([l, v]) => `${l} ${k(v)}`)
        .join(' · '),
  );
  out.push(
    'tool time (sum): ' +
      sorted(time)
        .map(([l, v]) => `${l} ${min(v)}`)
        .join(' · '),
  );
  const skills = skillCosts(records);
  if (skills.length)
    out.push(
      'subagents per run: ' +
        skills
          .map(
            (s) =>
              `${s.kind} ${s.runs}× avg ${Math.round(s.turns / s.runs)} turns ${k(s.cacheRead / s.runs)} read`,
          )
          .join(' · '),
    );
  const vt = verifyTimings();
  if (vt) out.push('verify medians: ' + vt);
  const hits = new Map();
  for (const r of records)
    for (const s of sessionSuggestions(r))
      hits.set(s.rule, [...(hits.get(s.rule) ?? []), `${label(r).slice(0, 24)}: ${s.text}`]);
  out.push('', 'rule hits:');
  for (const [rule, xs] of hits) out.push(`  ${rule} ×${xs.length}: ${xs[0]}`);
  for (const s of crossSuggestions(records)) out.push(`  [${s.rule}] ${s.text}`);
  return out.join('\n');
}

function retroDue(records) {
  const text = existsSync(improvements) ? readFileSync(improvements, 'utf8') : '';
  const { last, since, due } = retroStatus(text, records);
  return `${since} sessions since the last retro (${last.slice(0, 16)})${due ? ': retro due, run /retro' : ''}`;
}

const records = ingest();
if (!records.length) {
  console.log('no transcripts found');
  process.exit(0);
}
if (opt('retro-due') !== null) console.log(retroDue(records));
else if (opt('last') !== null) console.log(lastReport(records.slice(-Number(opt('last') || 8))));
else {
  const q = opt('session');
  const r = q
    ? records.find(
        (x) => x.id.startsWith(q) || (x.title ?? '').toLowerCase().includes(q.toLowerCase()),
      )
    : [...records].sort((a, b) => (a.end ?? '').localeCompare(b.end ?? '')).at(-1);
  console.log(r ? brief(r) : `no session matches "${q}"`);
}
