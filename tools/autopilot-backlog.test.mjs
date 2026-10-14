import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDecision,
  kindOf,
  next,
  parseDecisions,
  planRows,
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
  const six = Array.from({ length: 6 }, (_, i) => ({ id: `D-0${i}`, status: 'provisional' }));
  assert.match(next(backlog, six).none, /6 provisional/);
  for (const i of backlog.items) i.status = 'blocked';
  assert.match(next(backlog).none, /no ready item/);
  assert.throws(() => setItem(backlog, 'F-07.1', { status: 'nope' }, 't'), /status nope/);
});

test('autopilot backlog: decisions get the next id and escape pipes', () => {
  const out = addDecision(DECISIONS, {
    date: '2026-10-14',
    item: 'F-07.2',
    question: 'Label a|b?',
    chosen: 'a',
    alternatives: 'b',
    reversible: true,
  });
  assert.equal(out.id, 'D-03');
  const rows = parseDecisions(out.md);
  assert.equal(rows.at(-1).question, 'Label a/b?');
  assert.equal(rows.at(-1).status, 'provisional');
});
