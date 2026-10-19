import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDecisions,
  ahead,
  kindOf,
  liveOnly,
  liveTick,
  next,
  parseDecisions,
  planRows,
  points,
  setItem,
  splitOf,
  sync,
} from './autopilot/backlog-lib.mjs';

const PROGRESS = `## M2 · Before
- [ ] F-01.1 Old milestone item.
## M3 · Plan and Focus review
- [x] F-06.1 Header done. (95ba9b0)
- [ ] F-07.1 Three layouts switchable. — partial: layout A (f604e59); open: layout C; live check
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

test('autopilot backlog E12: a mixed row that adds an IPC command is split into two passes', () => {
  const rows =
    planRows(`| F-11.2 | \`gitlab/thread_actions.rs\`; commands \`gitlab_resolve(session, discussion)\` in \`commands/gitlab_threads.rs\`; ThreadCard actions | Rust \`f11_2_*\` + Vitest + e2e |
| F-12.1 | \`MrSummary.tsx\` replaces the stub | Vitest + design-check |
| F-17.1 | sources per scope, \`review_plan(session)\` | \`f17_1_*\` |
| F-13.1 | Threads tab filters | Vitest + e2e |
| F-08.8 | footer hints, \`claude_status\` command | cargo + e2e |
`);
  assert.equal(splitOf(rows.get('F-11.2')), true, 'command named in the build column, mixed tests');
  assert.equal(splitOf(rows.get('F-08.8')), true, 'a backticked command name');
  assert.equal(splitOf(rows.get('F-12.1')), false, 'no command');
  assert.equal(splitOf(rows.get('F-17.1')), false, 'core only: one pass');
  assert.equal(splitOf(rows.get('F-13.1')), false);
  assert.equal(splitOf(undefined), false);
  const progress = '## M5 · T\n- [ ] F-11.2 Actions.\n- [ ] F-12.1 Summary.\n';
  const planMd = [...rows].map(([id, r]) => `| ${id} | ${r.build} | ${r.test} |`).join('\n');
  const b = sync({
    progressMd: progress,
    planMd,
    decisionsMd: '',
    milestone: 'M5',
    previous: null,
    now: 't',
  });
  assert.equal(b.items.find((i) => i.id === 'F-11.2').split, true);
  assert.equal('split' in b.items.find((i) => i.id === 'F-12.1'), false);
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

test('autopilot backlog: next resumes a started item and respects deps', () => {
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

test('autopilot backlog: a criterion with only a live check open waits as live, not for the loop', () => {
  const md = `## M3 · Plan and Focus review
- [ ] F-07.4 Split diff. — partial: fold rows (2575c46, f604e59); open: live check in \`tauri dev\`
- [ ] F-07.9 Layout memory. — partial: global (6c15e0f); open: live check in \`tauri dev\`
- [ ] F-17.1 Same flow. — partial: plan (3558aee); open: decisions 12–15; live check in \`tauri dev\`
- [ ] F-09.6 Progressive notes. — partial: step task; open: live check of prefetch
`;
  assert.equal(liveOnly('task (6692508); open: live check of prefetch in `tauri dev`'), true);
  assert.equal(liveOnly('plan; open: decisions 12–15; live check'), false);
  assert.equal(liveOnly(''), false);
  const opts = { planMd: '', decisionsMd: '', milestone: 'M3', now: 't' };
  const first = sync({ ...opts, progressMd: md, previous: null });
  assert.deepEqual(
    first.items.map((i) => [i.id, i.status]),
    [
      ['F-07.4', 'live'],
      ['F-07.9', 'live'],
      ['F-17.1', 'todo'],
      ['F-09.6', 'live'],
    ],
  );
  assert.equal(next(first).id, 'F-17.1');
  // A failed live check goes back to the loop and stays todo until the conductor sets it live again.
  setItem(first, 'F-07.9', { status: 'todo', note: 'live check failed: opens in A' }, 't');
  const second = sync({ ...opts, progressMd: md, previous: first });
  assert.equal(second.items.find((i) => i.id === 'F-07.9').status, 'todo');
  const ticked = liveTick(md, 'F-07.4');
  assert.match(ticked, /^- \[x\] F-07\.4 Split diff\. \(2575c46, f604e59\)$/m);
  assert.throws(() => liveTick(md, 'F-09.6'), /no commit SHA in the PROGRESS note of F-09\.6/);
  assert.throws(() => liveTick(md, 'F-01.1'), /no open line for F-01\.1/);
  const third = sync({ ...opts, progressMd: ticked, previous: second });
  assert.equal(third.items.find((i) => i.id === 'F-07.4').status, 'done');
});

test('autopilot backlog: decisions get the next id and escape pipes', () => {
  const out = addDecisions(DECISIONS, {
    date: '2026-10-14',
    item: 'F-07.2',
    decisions: [
      {
        question: 'Label a|b?',
        chosen: 'a',
        why: 'consistent with S-03',
        alternatives: 'b',
        reversible: true,
      },
    ],
  });
  assert.equal(out.id, 'D-03');
  const rows = parseDecisions(out.md);
  assert.equal(rows.at(-1).question, '(1) Label a/b?');
  assert.deepEqual(points(rows.at(-1).question), ['Label a/b?']);
  assert.equal(rows.at(-1).chosen, '(1) a — consistent with S-03');
  assert.equal(rows.at(-1).status, 'decided');
});

test('autopilot backlog: one decision row per item, new points appended to its decided row', () => {
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

  // An item whose row the owner accepted or vetoed gets a new row; no decisions change nothing.
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

test('autopilot backlog: decided rows never stop the loop; only a veto adds work', () => {
  const decided = Array.from(
    { length: 8 },
    (_, i) => `| D-1${i} | d | F-0${i}.1 | (1) q | (1) c — why | - | yes | decided |`,
  ).join('\n');
  const backlog = sync({
    progressMd: PROGRESS,
    planMd: PLAN,
    decisionsMd: `${DECISIONS}${decided}\n`,
    milestone: 'M3',
    previous: null,
    now: 't',
  });
  assert.deepEqual(
    backlog.items.map((i) => i.id),
    ['F-07.1', 'F-07.2', 'F-17.1', 'D-02'],
  );
  assert.equal(next(backlog).id, 'F-07.1');
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

test('autopilot backlog: an accepted test dispute is remembered per file and survives sync', () => {
  const opts = { progressMd: PROGRESS, planMd: PLAN, decisionsMd: '', milestone: 'M3', now: 't' };
  const backlog = sync({ ...opts, previous: null });
  setItem(backlog, 'F-17.1', { status: 'review', dispute: 'tests/e2e/start.spec.ts@dcd5083' }, 't');
  setItem(backlog, 'F-17.1', { dispute: 'src/a.test.ts@1111111' }, 't');
  setItem(backlog, 'F-17.1', { dispute: 'tests/e2e/start.spec.ts@2222222' }, 't');
  const item = () => backlog.items.find((i) => i.id === 'F-17.1');
  assert.deepEqual(item().disputes, ['src/a.test.ts@1111111', 'tests/e2e/start.spec.ts@2222222']);
  assert.equal(item().status, 'review');
  assert.throws(
    () => setItem(backlog, 'F-17.1', { dispute: 'tests/e2e/start.spec.ts' }, 't'),
    /file@sha/,
  );
  const again = sync({ ...opts, previous: backlog });
  assert.deepEqual(again.items.find((i) => i.id === 'F-17.1').disputes, item().disputes);
  assert.equal(again.items.find((i) => i.id === 'F-07.2').disputes, undefined);
});

test('autopilot backlog E22: tests ahead go to the item next once the current one is done', () => {
  const backlog = {
    milestone: 'M4',
    items: [
      { id: 'F-08.1', deps: [], status: 'review', attempts: 1 },
      { id: 'F-08.2', deps: ['F-08.1'], status: 'todo', attempts: 0 },
      { id: 'F-08.3', deps: [], status: 'todo', attempts: 0 },
    ],
  };
  const [x, y] = backlog.items;
  assert.equal(next(backlog).id, 'F-08.1');
  assert.equal(ahead(backlog, 'F-08.1').id, 'F-08.2', 'ready as soon as F-08.1 is done');
  y.lockSha = '1111111';
  assert.match(ahead(backlog, 'F-08.1').none, /F-08\.2 has locked tests already/);
  delete y.lockSha;
  assert.throws(() => setItem(backlog, 'F-08.2', { status: 'tests-ready' }, 't'), /--fork/);
  const tests = ['tests/e2e/detailed-f08-2.spec.ts'];
  setItem(
    backlog,
    'F-08.2',
    { status: 'tests-ready', lockSha: 'abc1234', tests, fork: 'def5678' },
    't',
  );
  assert.deepEqual(
    [y.status, y.lockSha, y.forkSha, y.attempts],
    ['tests-ready', 'abc1234', 'def5678', 0],
  );
  assert.equal(next(backlog).id, 'F-08.1', 'the started item first');
  assert.match(ahead(backlog, 'F-08.1').none, /F-08\.2 comes next \(tests-ready\)/);
  x.status = 'blocked';
  assert.equal(next(backlog).id, 'F-08.3', 'tests ahead wait while their deps are not done');
  x.status = 'done';
  assert.equal(next(backlog).id, 'F-08.2', 'before a new item');
  assert.throws(() => ahead(backlog, 'F-09.9'), /no item F-09\.9/);

  // Kept: the lock moves to the merge; the fork is no longer needed.
  setItem(backlog, 'F-08.2', { status: 'impl', attempt: true, lockSha: '9999999' }, 't');
  assert.deepEqual(
    [y.status, y.lockSha, y.forkSha, y.tests, y.attempts],
    ['impl', '9999999', undefined, tests, 1],
  );
  // Discarded: written again from the base, so nothing stays locked.
  setItem(backlog, 'F-08.3', { status: 'tests-ready', lockSha: 'a', tests, fork: 'b' }, 't');
  setItem(backlog, 'F-08.3', { status: 'tests', attempt: true, discard: true }, 't');
  const z = backlog.items[2];
  assert.deepEqual(
    [z.status, z.lockSha, z.tests, z.forkSha],
    ['tests', undefined, undefined, undefined],
  );
});

test('autopilot backlog E22: sync keeps tests written ahead with their fork', () => {
  const opts = { progressMd: PROGRESS, planMd: PLAN, decisionsMd: '', milestone: 'M3', now: 't' };
  const backlog = sync({ ...opts, previous: null });
  const tests = ['tests/e2e/step-f07-2.spec.ts'];
  setItem(
    backlog,
    'F-07.2',
    { status: 'tests-ready', lockSha: 'abc1234', tests, fork: 'def5678' },
    't',
  );
  const again = sync({ ...opts, previous: backlog }).items.find((i) => i.id === 'F-07.2');
  assert.deepEqual(
    [again.status, again.lockSha, again.tests, again.forkSha],
    ['tests-ready', 'abc1234', tests, 'def5678'],
  );
});
