import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addEntry, curate, empty, rate, render, select, touch } from './autopilot/playbook-lib.mjs';
import { buildRow, judge, summary } from './autopilot/items-lib.mjs';

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
