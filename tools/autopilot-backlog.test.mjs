import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDecisions,
  kindOf,
  next,
  parseDecisions,
  planRows,
  points,
  setItem,
  sync,
} from './autopilot/backlog-lib.mjs';

const PROGRESS = `## M2 · Before
- [ ] F-01.1 Old milestone item.
## M3 · Plan and Focus review
- [x] F-06.1 Header done. (95ba9b0)
- [ ] F-07.1 Three layouts switchable. — partial: layout A (f604e59); open: live check
- [ ] F-07.2 Step header with Mark reviewed.
- [ ] F-17.1 Same plan flow.
## M4 · Detailed
- [ ] F-08.1 Mode toggle.
`;
const PLAN = `| F-07.1 | S-03 shell | e2e \`step.spec\` |
| F-07.2 | Step header | Vitest + e2e |
| F-17.1 | sources per scope | \`f17_1_*\` |
`;
const DECISIONS = `| ID | Date | Item | Question | Chosen | Alternatives | Reversible | Status |
| - | - | - | - | - | - | - | - |
| D-01 | 2026-10-14 | F-07.2 | Space in inputs? | ignored | toggle | yes | accepted |
| D-02 | 2026-10-14 | F-17.1 | Commits order? | oldest first | newest | yes | vetoed |
`;

test('autopilot backlog: plan rows and kinds from the test column', () => {
  const rows = planRows(PLAN);
  assert.equal(rows.size, 3);
  assert.equal(kindOf(rows.get('F-07.1')), 'ui');
  assert.equal(kindOf(rows.get('F-17.1')), 'core');
  assert.equal(kindOf(undefined), 'mixed');
});

test('autopilot backlog: sync keeps the milestone open items, statuses and vetoed decisions', () => {
  const first = sync({
    progressMd: PROGRESS,
    planMd: PLAN,
    decisionsMd: DECISIONS,
    milestone: 'M3',
    previous: null,
    now: 't1',
  });
  assert.deepEqual(
    first.items.map((i) => [i.id, i.status, i.kind]),
    [
      ['F-07.1', 'todo', 'ui'],
      ['F-07.2', 'todo', 'ui'],
      ['F-17.1', 'todo', 'core'],
      ['D-02', 'todo', 'mixed'],
    ],
  );
  assert.equal(first.items[0].title, 'Three layouts switchable.');
  assert.match(first.items[0].note, /live check/);
  setItem(first, 'F-07.2', { status: 'impl', attempt: true }, 't2');
  const ticked = PROGRESS.replace('- [ ] F-07.1 Three', '- [x] F-07.1 Three');
  const second = sync({
    progressMd: ticked,
    planMd: PLAN,
    decisionsMd: DECISIONS,
    milestone: 'M3',
    previous: first,
    now: 't3',
  });
  const byId = Object.fromEntries(second.items.map((i) => [i.id, i]));
  assert.equal(byId['F-07.1'].status, 'done');
  assert.equal(byId['F-07.2'].status, 'impl');
  assert.equal(byId['F-07.2'].attempts, 1);
});

test('autopilot backlog: next resumes a started item, respects deps and the provisional cap', () => {
  const backlog = sync({
    progressMd: PROGRESS,
    planMd: PLAN,
    decisionsMd: '',
    milestone: 'M3',
    previous: null,
    now: 't',
  });
  backlog.items[0].deps = ['F-17.1'];
  assert.equal(next(backlog).id, 'F-07.2');
  setItem(backlog, 'F-17.1', { status: 'review' }, 't');
  assert.equal(next(backlog).id, 'F-17.1');
  setItem(backlog, 'F-17.1', { status: 'done' }, 't');
  assert.equal(next(backlog).id, 'F-07.1');
  const six = Array.from({ length: 6 }, (_, i) => ({
    id: `D-0${i}`,
    item: `F-0${i}.1`,
    status: 'provisional',
  }));
  assert.match(next(backlog, six).none, /6 items with provisional decisions/);
  for (const i of backlog.items) i.status = 'blocked';
  assert.match(next(backlog).none, /no ready item/);
  assert.throws(() => setItem(backlog, 'F-07.1', { status: 'nope' }, 't'), /status nope/);
  assert.throws(
    () =>
      setItem(
        backlog,
        'F-07.1',
        {
          tests: [
            'src-tauri/src/store/sessions_progress_tests.rs',
            'src-tauri/src/store/sessions.rs',
          ],
        },
        't',
      ),
    /not test files, lock only tests: .*store.sessions.rs$/,
  );
  setItem(backlog, 'F-07.1', { lockSha: 'a9ff402', tests: ['tests/e2e/start.spec.ts'] }, 't');
});

test('autopilot backlog: decisions get the next id and escape pipes', () => {
  const out = addDecisions(DECISIONS, {
    date: '2026-10-14',
    item: 'F-07.2',
    decisions: [{ question: 'Label a|b?', chosen: 'a', alternatives: 'b', reversible: true }],
  });
  assert.equal(out.id, 'D-03');
  const rows = parseDecisions(out.md);
  assert.equal(rows.at(-1).question, '(1) Label a/b?');
  assert.deepEqual(points(rows.at(-1).question), ['Label a/b?']);
  assert.equal(rows.at(-1).status, 'provisional');
});

test('autopilot backlog: one decision row per item, new points appended to its provisional row', () => {
  const q = (question, reversible = true) => ({ question, chosen: `c ${question}`, reversible });
  const first = addDecisions(DECISIONS, {
    date: '2026-10-14',
    item: 'F-04.3',
    decisions: [q('Scroll per step?'), q('Layout\nper session?')],
  });
  assert.deepEqual([first.id, first.added, first.appended], ['D-03', 2, false]);
  const row = parseDecisions(first.md).at(-1);
  assert.equal(row.question, '(1) Scroll per step?<br>(2) Layout per session?');
  assert.equal(row.chosen, '(1) c Scroll per step?<br>(2) c Layout per session?');
  assert.equal(row.reversible, 'yes');

  // The fix round of the same item: a repeated question is skipped, the new one appended.
  const second = addDecisions(first.md, {
    date: '2026-10-15',
    item: 'F-04.3',
    decisions: [q('scroll per step?'), q('Drafts kept?', false)],
  });
  assert.deepEqual([second.id, second.added, second.appended], ['D-03', 1, true]);
  const rows = parseDecisions(second.md);
  assert.equal(rows.filter((d) => d.item === 'F-04.3').length, 1);
  const merged = rows.at(-1);
  assert.equal(merged.date, '2026-10-14');
  assert.deepEqual(points(merged.question), [
    'Scroll per step?',
    'Layout per session?',
    'Drafts kept?',
  ]);
  assert.deepEqual(points(merged.alternatives), ['-', '-', '-']);
  assert.equal(merged.reversible, '(1) yes<br>(2) yes<br>(3) no');

  // An item whose row the owner already reviewed gets a new row; no decisions change nothing.
  const other = addDecisions(second.md, { date: 'd', item: 'F-07.2', decisions: [q('Copy?')] });
  assert.equal(other.id, 'D-04');
  assert.deepEqual(addDecisions(other.md, { date: 'd', item: 'F-07.2', decisions: [] }), {
    id: 'D-04',
    md: other.md,
    added: 0,
    appended: false,
  });
  assert.throws(
    () => addDecisions(DECISIONS, { date: 'd', item: 'F-07.2', decisions: [{ question: 'x' }] }),
    /question and chosen/,
  );
  assert.throws(() => addDecisions(DECISIONS, { date: 'd', item: 'F-07.2' }), /decisions: \[/);
});

test('autopilot backlog: the provisional cap counts items, not rows or points', () => {
  const backlog = sync({
    progressMd: PROGRESS,
    planMd: PLAN,
    decisionsMd: '',
    milestone: 'M3',
    previous: null,
    now: 't',
  });
  const rows = (items) => items.map((item, i) => ({ id: `D-${i}`, item, status: 'provisional' }));
  assert.equal(next(backlog, rows(Array(8).fill('F-04.1'))).id, 'F-07.1');
  assert.equal(
    next(backlog, rows(['F-01.1', 'F-01.2', 'F-01.3', 'F-01.4', 'F-01.5'])).id,
    'F-07.1',
  );
  const six = rows(['F-01.1', 'F-01.2', 'F-01.3', 'F-01.4', 'F-01.5', 'F-01.6', 'F-01.6']);
  assert.match(next(backlog, six).none, /^6 items with provisional decisions .*max 5/);
  const reviewed = six.map((d, i) => (i < 2 ? { ...d, status: 'accepted' } : d));
  assert.equal(next(backlog, reviewed).id, 'F-07.1');
});

test('autopilot backlog: a veto of some points of a row still adds one rework item', () => {
  const md = DECISIONS.replace(
    '| oldest first | newest | yes | vetoed |',
    '| (1) a<br>(2) b | x | yes | vetoed (2) |',
  );
  const backlog = sync({
    progressMd: PROGRESS,
    planMd: PLAN,
    decisionsMd: md,
    milestone: 'M3',
    previous: null,
    now: 't',
  });
  const rework = backlog.items.find((i) => i.id === 'D-02');
  assert.equal(rework.status, 'todo');
  assert.match(rework.note, /^vetoed \(2\): \(1\) a<br>\(2\) b; item F-17\.1$/);
});
