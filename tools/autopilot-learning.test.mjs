import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addEntry, curate, empty, rate, render, select, touch } from './autopilot/playbook-lib.mjs';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRow, judge, roleUsage, summary } from './autopilot/items-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('autopilot playbook: duplicates count, selection by word tag or path glob within budget', () => {
  const pb = empty();
  const a = addEntry(pb, { tags: ['ui'], text: 'Lift hooks above layout switches.' }, 't');
  const b = addEntry(
    pb,
    { tags: ['src-tauri/src/**'], text: 'Map store errors at the command.' },
    't',
  );
  const again = addEntry(
    pb,
    { tags: ['implement'], text: 'lift hooks above layout switches' },
    't',
  );
  assert.deepEqual([a.id, b.id, again.id, again.duplicate], ['P-001', 'P-002', 'P-001', true]);
  assert.deepEqual(pb.entries[0].tags, ['ui', 'implement']);
  assert.deepEqual(
    select(pb, { tags: ['ui'] }).map((e) => e.id),
    ['P-001'],
  );
  assert.deepEqual(
    select(pb, { tags: [], paths: ['src-tauri/src/review/progress.rs'] }).map((e) => e.id),
    ['P-002'],
  );
  assert.deepEqual(select(pb, { tags: ['ui'] }, 3), []);
  assert.equal(render(select(pb, { tags: ['ui'] })), '- [P-001] Lift hooks above layout switches.');
  assert.throws(() => addEntry(pb, { text: ' ' }, 't'), /needs text/);
});

test('autopilot playbook: curate prunes harmful and stale entries, proposes recurring ones', () => {
  const pb = empty();
  addEntry(pb, { tags: ['ui'], text: 'harmful one' }, 't');
  addEntry(pb, { tags: ['ui'], text: 'stale one' }, 't');
  addEntry(pb, { tags: ['ui'], text: 'recurring one' }, 't');
  rate(pb, 'P-001', 'harmful');
  rate(pb, 'P-001', 'harmful');
  for (let i = 0; i < 2; i++) addEntry(pb, { tags: ['ui'], text: 'recurring one' }, 't');
  pb.items = 30;
  touch(pb, ['P-003']);
  const out = curate(pb);
  assert.deepEqual(out.removed, ['P-001', 'P-002']);
  assert.deepEqual(
    out.proposals.map((e) => e.id),
    ['P-003'],
  );
  assert.throws(() => rate(pb, 'P-003', 'meh'), /helpful or harmful/);
});

const row = (ts, extra = {}) => ({
  ts,
  run: 'ap-1',
  result: 'done',
  gateFirstPass: true,
  rounds: 0,
  findings: { severe: 0 },
  tokens: { total: 100 },
  ...extra,
});

test('autopilot metrics: a row from the verdicts, tokens per role', () => {
  const r = buildRow({
    item: 'F-07.2',
    run: 'ap-1',
    result: 'done',
    startedAt: '2026-10-14T10:00:00.000Z',
    endedAt: '2026-10-14T10:30:00.000Z',
    verdicts: {
      tests: { tokens: 10 },
      impl: { tokens: 50, decisions: [{}] },
      review: { tokens: 20, findings: [{ severity: 'severe' }, { severity: 'nit' }] },
      'fix-1': { tokens: 15 },
      'gate-1': { pass: false },
      'gate-2': { pass: true },
      reflect: { tokens: 5 },
    },
  });
  assert.deepEqual(r.tokens, { total: 100, tests: 10, impl: 50, review: 20, fix: 15, reflect: 5 });
  assert.equal(r.gateFirstPass, false);
  assert.equal(r.gates, 2);
  assert.equal(r.rounds, 1);
  assert.deepEqual(r.findings, { severe: 1, normal: 0, nit: 1 });
  assert.equal(r.decisions, 1);
  assert.equal(r.wallMin, 30);
});

const usageOf = (input, cacheRead, cacheWrite, output) => ({
  input,
  cacheRead,
  cacheWrite,
  output,
});

test('autopilot metrics: tokens per role from the role transcripts, attempt by start time', () => {
  const since = '2026-10-14T10:00:00.000Z';
  const at = (min) => Date.parse(since) + min * 60_000;
  const subagents = [
    { description: 'ap tests F-07.2', start: at(1), totals: usageOf(1, 100, 10, 2) },
    { description: 'ap implement F-07.2', start: at(5), totals: usageOf(2, 300, 20, 5) },
    { description: 'ap fix-1 F-07.2', start: at(9), totals: usageOf(1, 50, 0, 1) },
    { description: 'ap fix-2 F-07.2', start: at(12), totals: usageOf(1, 40, 0, 1) },
    // An earlier attempt, another item and a non-role agent do not count.
    { description: 'ap tests F-07.2', start: at(-30), totals: usageOf(9, 900, 90, 9) },
    { description: 'ap review F-07.3', start: at(3), totals: usageOf(9, 900, 90, 9) },
    { description: 'design-check S03', start: at(4), totals: usageOf(9, 900, 90, 9) },
  ];
  const u = roleUsage(subagents, { item: 'F-07.2', since });
  assert.deepEqual(u.tokens, { total: 534, tests: 113, impl: 327, fix: 94 });
  assert.equal(u.cacheRead, 490);
  assert.equal(roleUsage(subagents, { item: 'F-09.1', since }), null);
  const row = buildRow({
    item: 'F-07.2',
    run: 'ap-1',
    result: 'done',
    verdicts: { tests: { tokens: 7 }, impl: { tokens: 8 } },
    endedAt: since,
    usage: u,
  });
  assert.deepEqual(row.tokens, u.tokens);
  assert.equal(row.tokenSource, 'transcript');
  assert.equal(row.cacheRead, 490);
});

test('autopilot metrics: record.mjs reads the conductor session transcripts, else the verdicts', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gr-record-'));
  const slug = root.replace(/[^a-zA-Z0-9]/g, '-');
  const sub = join(tmp, 'projects', slug, 'sess-1', 'subagents');
  mkdirSync(sub, { recursive: true });
  const turn = (id, ts, cacheRead) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: ts,
      message: {
        id,
        model: 'm',
        content: [],
        usage: { input_tokens: 1, cache_read_input_tokens: cacheRead, output_tokens: 2 },
      },
    });
  writeFileSync(
    join(sub, 'agent-a1.jsonl'),
    `${turn('m1', '2026-10-14T10:01:00Z', 1000)}\n${turn('m2', '2026-10-14T10:02:00Z', 3000)}\n`,
  );
  writeFileSync(
    join(sub, 'agent-a1.meta.json'),
    JSON.stringify({ description: 'ap review F-07.2' }),
  );
  const items = join(tmp, 'items');
  mkdirSync(items);
  writeFileSync(join(items, 'review.json'), JSON.stringify({ findings: [], tokens: 5 }));
  const record = (session) => {
    const out = join(tmp, `${session}.jsonl`);
    const r = spawnSync(
      process.execPath,
      [
        join(root, 'tools', 'autopilot', 'record.mjs'),
        'F-07.2',
        '--run',
        'ap-1',
        '--result',
        'done',
        '--dir',
        items,
        '--started',
        '2026-10-14T10:00:00Z',
        '--session',
        session,
        '--out',
        out,
      ],
      { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: tmp } },
    );
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(readFileSync(out, 'utf8').trim());
  };
  const fromTranscript = record('sess-1');
  assert.deepEqual(fromTranscript.tokens, { total: 4006, review: 4006 });
  assert.equal(fromTranscript.cacheRead, 4000);
  assert.equal(fromTranscript.tokenSource, 'transcript');
  const fromVerdicts = record('sess-unknown');
  assert.deepEqual(fromVerdicts.tokens, { total: 5, review: 5 });
  assert.equal(fromVerdicts.tokenSource, 'agent');
});

test('autopilot metrics: judge waits for k rows, keeps or reverts by direction', () => {
  const before = [1, 2, 3].map((i) => row(`2026-10-0${i}`));
  const cheaper = [4, 5, 6].map((i) => row(`2026-10-0${i}`, { tokens: { total: 80 } }));
  const failing = [4, 5, 6].map((i) => row(`2026-10-0${i}`, { gateFirstPass: false }));
  assert.equal(judge(before, { since: '2026-10-04', metric: 'tokens', k: 3 }).verdict, 'wait');
  assert.equal(
    judge([...before, ...cheaper], { since: '2026-10-04', metric: 'tokens', k: 3 }).verdict,
    'keep',
  );
  assert.equal(
    judge([...before, ...failing], { since: '2026-10-04', metric: 'gateFirstPass', k: 3 }).verdict,
    'revert',
  );
  assert.throws(() => judge(before, { since: 'x', metric: 'nope' }), /metric/);
  assert.equal(summary([...before, ...cheaper]).tokens, 90);
  assert.equal(summary([...before, row('2026-10-09', { run: 'ap-2' })], 'ap-2').items, 1);
});

test('autopilot metrics: the first gate call decides first pass; record.mjs takes the live result', () => {
  const verdicts = {
    'gate-10': { pass: true },
    'gate-2': { pass: true },
    'gate-1': { pass: false },
  };
  const r = buildRow({ item: 'F-17.1', run: 'ap-1', result: 'live', verdicts, endedAt: 't' });
  assert.equal(r.gateFirstPass, false);
  assert.equal(r.gates, 3);
  assert.equal(r.result, 'live');
  assert.equal(
    buildRow({ item: 'F-17.1', run: 'ap-1', result: 'done', verdicts: {}, endedAt: 't' })
      .gateFirstPass,
    false,
  );
  const tmp = mkdtempSync(join(tmpdir(), 'gr-record-'));
  const record = (result) =>
    spawnSync(
      process.execPath,
      [
        join(root, 'tools', 'autopilot', 'record.mjs'),
        'F-17.1',
        '--run',
        'ap-1',
        '--result',
        result,
        '--dir',
        join(tmp, 'none'),
        '--session',
        'none',
        '--out',
        join(tmp, 'items.jsonl'),
      ],
      { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: tmp } },
    );
  assert.equal(record('live').status, 0);
  assert.equal(JSON.parse(readFileSync(join(tmp, 'items.jsonl'), 'utf8')).result, 'live');
  const bad = record('built');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--result done\|partial\|live\|blocked\|needs-owner/);
});
