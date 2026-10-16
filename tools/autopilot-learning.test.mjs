import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addEntry,
  addRule,
  curate,
  empty,
  existing,
  hold,
  merge,
  promote,
  rate,
  render,
  select,
  touch,
} from './autopilot/playbook-lib.mjs';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRow, judge, pace, roleUsage, summary } from './autopilot/items-lib.mjs';

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

test('autopilot metrics E22: pace = run time per finished criterion; accepted test disputes', () => {
  const rows = [
    row('2026-10-15T10:30:00.000Z', { item: 'F-08.1', wallMin: 30, testDispute: 'accept' }),
    row('2026-10-15T11:00:00.000Z', { item: 'F-08.2', wallMin: 20, result: 'blocked' }),
    row('2026-10-15T11:20:00.000Z', { item: 'F-08.3', wallMin: 15, result: 'live' }),
    row('2026-10-15T11:00:00.000Z', { item: 'F-09.1', wallMin: 5, run: 'ap-2' }),
  ];
  const run = summary(rows, 'ap-1');
  assert.equal(run.pace, 40, '10:00 to 11:20 over F-08.1 and F-08.3');
  assert.equal(run.disputes, 1 / 3);
  assert.equal(summary(rows).pace, undefined, 'only per run');
  assert.equal(pace([row('2026-10-15T10:00:00.000Z', { result: 'blocked', wallMin: 5 })]), null);
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

test('autopilot playbook E17: promotion by helpful count, a lesson confirmed by id, merge, lessons to compare', () => {
  const pb = empty();
  addEntry(pb, { tags: ['core', 'tests'], text: 'Assert what can fail.' }, 't');
  addEntry(pb, { tags: ['ui', 'implement', 'src/screens/**'], text: 'Seed the mock.' }, 't');
  addEntry(
    pb,
    { tags: ['ui', 'tests'], text: 'Name the change that would fail the assertion.' },
    't',
  );
  addEntry(pb, { tags: ['mixed', 'fix'], text: 'Run new test binaries several times.' }, 't');
  for (let i = 0; i < 3; i++) rate(pb, 'P-002', 'helpful');
  for (let i = 0; i < 4; i++) rate(pb, 'P-004', 'helpful');
  rate(pb, 'P-004', 'harmful');
  const again = addEntry(
    pb,
    { same: 'P-001', tags: ['src-tauri/tests/**'], source: 'F-09.5' },
    't',
  );
  assert.deepEqual(again, { id: 'P-001', duplicate: true });
  addEntry(pb, { same: 'P-001', tags: [] }, 't');
  assert.deepEqual(pb.entries[0].tags, ['core', 'tests', 'src-tauri/tests/**']);
  assert.throws(() => addEntry(pb, { same: 'P-099' }, 't'), /no entry P-099/);
  assert.deepEqual(
    curate(structuredClone(pb)).proposals.map((e) => e.id),
    ['P-001', 'P-002'],
  );
  assert.deepEqual(
    existing(pb, { kind: 'core', paths: ['src/screens/step/Step.tsx'], offered: ['P-004'] }).map(
      (e) => e.id,
    ),
    ['P-002', 'P-001', 'P-004'],
  );
  assert.deepEqual(existing(pb, { kind: 'core' }, 3), []);
  const kept = merge(pb, 'P-001', 'P-003');
  assert.deepEqual(
    [kept.seen, kept.helpful, kept.harmful, kept.tags],
    [4, 0, 0, ['core', 'tests', 'src-tauri/tests/**', 'ui']],
  );
  assert.deepEqual(
    pb.entries.map((e) => e.id),
    ['P-001', 'P-002', 'P-004'],
  );
  assert.throws(() => merge(pb, 'P-001', 'P-001'), /two entries/);
  assert.throws(() => merge(pb, 'P-001', 'P-003'), /two entries/);
  const row = buildRow({
    item: 'F-09.5',
    run: 'ap-1',
    result: 'live',
    endedAt: 't',
    verdicts: {
      reflect: {
        lessons: [{ text: 'x', tags: [] }, { same: 'P-001', tags: [] }, { same: 'P-002' }],
      },
    },
  });
  assert.deepEqual(row.lessons, { new: 1, same: 2 });
});

test('autopilot playbook E17: promote writes the rule into the role file through the CLI', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gr playbook ł-'));
  try {
    const pb = empty();
    addEntry(pb, { tags: ['core', 'tests'], text: 'Assert what can fail.' }, 't');
    addEntry(pb, { tags: ['ui', 'implement'], text: 'Seed the mock.' }, 't');
    for (let i = 0; i < 3; i++) rate(pb, 'P-001', 'helpful');
    mkdirSync(join(tmp, 'docs', 'process'), { recursive: true });
    mkdirSync(join(tmp, '.claude', 'autopilot', 'roles'), { recursive: true });
    const pbFile = join(tmp, 'docs', 'process', 'playbook.json');
    const roleFile = join(tmp, '.claude', 'autopilot', 'roles', 'tests.md');
    writeFileSync(pbFile, JSON.stringify(pb));
    writeFileSync(roleFile, 'Objective: x.\n\nOutput:\n```json\n{}\n```\n');
    const cli = (...a) =>
      spawnSync(
        process.execPath,
        [join(root, 'tools', 'autopilot', 'playbook.mjs'), ...a, '--root', tmp],
        { encoding: 'utf8' },
      );
    const ok = cli('promote', 'P-001', 'tests', 'Name the change that would fail each assertion.');
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(
      readFileSync(roleFile, 'utf8'),
      'Objective: x.\n\nOutput:\n```json\n{}\n```\n\n## Rules learned\n\n- Name the change that would fail each assertion. (P-001)\n',
    );
    const saved = JSON.parse(readFileSync(pbFile, 'utf8')).entries[0];
    assert.deepEqual([saved.promoted, saved.promotedTo], [true, 'tests']);
    assert.match(cli('promote', 'P-001', 'tests', 'Again.').stderr, /already promoted/);
    assert.match(cli('promote', 'P-002', 'implement', 'Seed it.').stderr, /not a rule proposal/);
    assert.match(cli('promote', 'P-001', 'curate', 'x').stderr, /role curate/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('autopilot playbook E17: addRule appends to the rules list, once per entry, one line only', () => {
  const md = 'Objective: x.\n\n## Rules learned\n\n- First. (P-001)\n\n## After\n\ny\n';
  assert.equal(
    addRule(md, 'P-002', 'Second.'),
    'Objective: x.\n\n## Rules learned\n\n- First. (P-001)\n- Second. (P-002)\n\n## After\n\ny\n',
  );
  assert.equal(addRule(md, 'P-001', 'Again.'), md);
  assert.throws(() => addRule(md, 'P-003', 'two\nlines'), /one line/);
  assert.throws(() => addRule(md, 'P-003', 'uses {{wt}}'), /one line/);
  assert.throws(() => addRule(md, 'P-003', 'an undefined state'), /undefined/);
});

test('autopilot playbook E17: an entry on hold is never a rule proposal', () => {
  const pb = empty();
  addEntry(pb, { tags: ['core', 'tests'], text: 'Assert what can fail.' }, 't');
  addEntry(pb, { tags: ['ui', 'implement'], text: 'Seed the mock.' }, 't');
  for (const id of ['P-001', 'P-002']) for (let i = 0; i < 3; i++) rate(pb, id, 'helpful');
  hold(pb, ['P-002'], 'E18 group B lint replaces it');
  assert.deepEqual(
    curate(structuredClone(pb)).proposals.map((e) => e.id),
    ['P-001'],
  );
  assert.throws(() => promote(pb, 'P-002', 'implement'), /on hold: E18 group B lint replaces it/);
  assert.throws(() => hold(pb, ['P-009'], 'x'), /no entry P-009/);
  assert.equal(merge(pb, 'P-001', 'P-002').hold, 'E18 group B lint replaces it');
  assert.throws(() => hold(pb, ['P-001'], ' '), /needs a reason/);
});

test('autopilot playbook E20: curate --dry-run prints the proposals as one JSON line and saves nothing', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'gr playbook ł-'));
  try {
    const pb = empty();
    addEntry(pb, { tags: ['core', 'tests'], text: 'Assert what can fail.' }, 't');
    addEntry(pb, { tags: ['ui', 'implement'], text: 'Seed the mock.' }, 't');
    for (let i = 0; i < 3; i++) rate(pb, 'P-001', 'helpful');
    rate(pb, 'P-002', 'harmful');
    rate(pb, 'P-002', 'harmful');
    mkdirSync(join(tmp, 'docs', 'process'), { recursive: true });
    const pbFile = join(tmp, 'docs', 'process', 'playbook.json');
    const before = JSON.stringify(pb);
    writeFileSync(pbFile, before);
    const cli = (...a) =>
      spawnSync(
        process.execPath,
        [join(root, 'tools', 'autopilot', 'playbook.mjs'), 'curate', ...a, '--root', tmp],
        { encoding: 'utf8' },
      );
    const dry = cli('--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(dry.stdout.trim().split('\n').length, 1);
    const out = JSON.parse(dry.stdout);
    assert.deepEqual(out.removed, ['P-002']);
    assert.deepEqual(
      out.proposals.map((p) => p.id),
      ['P-001'],
    );
    assert.equal(readFileSync(pbFile, 'utf8'), before);
    // nothing waits once the proposal is promoted: the Closing step of an autopilot run skips the curator
    const promoted = JSON.parse(before);
    promoted.entries[0].promoted = true;
    writeFileSync(pbFile, JSON.stringify(promoted));
    assert.deepEqual(JSON.parse(cli('--dry-run').stdout).proposals, []);
    // the real run prunes and saves
    assert.equal(cli().status, 0);
    assert.deepEqual(
      JSON.parse(readFileSync(pbFile, 'utf8')).entries.map((e) => e.id),
      ['P-001'],
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
