import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ROLES,
  composePrompt,
  contextFiles,
  fields,
  fixProblems,
  itemHistory,
  offeredIds,
  promptValues,
  coreVerifyCommand,
  verifyCommand,
} from './autopilot/prompt-lib.mjs';

const ROLES_DIR = join(import.meta.dirname, '..', '.claude', 'autopilot', 'roles');
const PROMPT = join(import.meta.dirname, 'autopilot', 'prompt.mjs');
const role = (name) => readFileSync(join(ROLES_DIR, `${name}.md`), 'utf8');
const COMMON = role('_common');

const ITEM = {
  id: 'F-04.3',
  milestone: 'M3',
  title: 'Session state is saved.',
  kind: 'mixed',
  status: 'done',
  lockSha: 'abc1234',
  tests: ['src-tauri/src/store/state_tests.rs', 'tests/e2e/step.spec.ts'],
};
const CONTEXT = `# Context pack
## Files
- src/a.ts
## Playbook (lessons from earlier items)
- [P-001] One lesson.
- [P-003] Another lesson.
`;
const REVIEW = {
  findings: [
    { severity: 'severe', file: 'src/a.ts', line: 3, text: 'counts the raw plan' },
    { severity: 'nit', file: 'src/b.ts', line: 1, text: 'long file' },
  ],
  testDispute: 'accept',
  testDisputeDetail: { test: 'tests/e2e/step.spec.ts:20', reason: 'cards sit side by side' },
  verdict: 'fix',
};
const LIVE = {
  ...ITEM,
  id: 'F-09.6',
  title: 'Notes appear progressively.',
  status: 'live',
  note: 'step task (6692508); open: live check in `tauri dev`',
};
const args = (name, over = {}) => ({
  role: name,
  id: name === 'plan' ? 'M4' : 'F-04.3',
  item: name === 'plan' || name === 'curate' ? null : ITEM,
  run: { runId: 'ap-20261015-0900', milestone: 'M3' },
  base: 'm3-plan-focus',
  root: 'C:\\Repos\\guided review ł',
  wt: 'C:\\Repos\\gr-ap',
  itemDir: 'C:\\Repos\\guided review ł\\.autopilot\\items\\F-04.3',
  files: { context: CONTEXT, impl: { testDispute: 'step.spec.ts:20 order' }, review: REVIEW },
  live: [ITEM, LIVE],
  ...over,
});

test('autopilot prompt: every role composes with no empty field', () => {
  for (const name of ROLES) {
    const text = composePrompt(COMMON, role(name), promptValues(args(name)));
    assert.deepEqual(fields(text), [], `${name}: unfilled fields`);
    assert.doesNotMatch(text, /<!--|undefined/, name);
    assert.match(text, /^Guided Review · autopilot run ap-20261015-0900 · role /, name);
  }
  const implement = composePrompt(COMMON, role('implement'), promptValues(args('implement')));
  assert.match(implement, /Worktree C:\/Repos\/gr-ap, branch ap\/f04-3 from m3-plan-focus/);
  assert.match(implement, /\.autopilot\/items\/F-04\.3\/context\.md/);
  assert.match(
    implement,
    /Done when: `GR_PORT=1510 node tools\/verify\.mjs --e2e step` is green \(run it exactly so\)/,
  );
  assert.match(implement, /state_tests\.rs, tests\/e2e\/step\.spec\.ts/);
  const tests = composePrompt(COMMON, role('tests'), promptValues(args('tests')));
  assert.match(tests, /named `f04_3_…`/);
  const fix = composePrompt(COMMON, role('fix'), promptValues(args('fix')));
  assert.match(fix, /- \[severe\] src\/a\.ts:3 counts the raw plan/);
  assert.match(
    fix,
    /accepted test dispute \(change only this test\): tests\/e2e\/step\.spec\.ts:20/,
  );
  assert.doesNotMatch(fix, /long file/);
  const reflect = composePrompt(COMMON, role('reflect'), promptValues(args('reflect')));
  assert.match(reflect, /result done/);
  assert.match(reflect, /offered: P-001, P-003/);
  assert.match(reflect, /guided review ł\/\.autopilot\/items\/F-04\.3/);
  const plan = composePrompt(COMMON, role('plan'), promptValues(args('plan', { run: null })));
  assert.match(plan, /run not started yet .* item M4 plan \(process, M4\)/);
  assert.match(plan, /Worktree C:\/Repos\/guided review ł, branch m3-plan-focus/);
  const live = composePrompt(COMMON, role('live'), promptValues(args('live')));
  assert.match(
    live,
    /role live · item M3 live checks \(process, M3\): check the waiting criteria in the real app/,
  );
  assert.match(
    live,
    /^- F-09\.6 Notes appear progressively\. — step task \(6692508\); open: live check/m,
  );
  assert.doesNotMatch(live, /^- F-04\.3/m);
  assert.match(live, /Worktree C:\/Repos\/guided review ł, branch m3-plan-focus/);
  assert.match(live, /run \.app-driver\/live-ap-20261015-0900\/<id>\.json/);
});

test('autopilot prompt E12: the implementer of a two-pass item gets its pass and verify', () => {
  const compose = (over) =>
    composePrompt(COMMON, role('implement'), promptValues(args('implement', over)));
  assert.match(compose({}), /^Scope: the whole criterion in one pass\.$/m);
  const tests = ['src-tauri/tests/a.rs', 'src/ipc/mock/threads.test.ts', 'src/screens/A.test.tsx'];
  const core = compose({ part: 'core', item: { ...ITEM, tests } });
  assert.match(core, /^Scope: pass 1 of 2 \(E12/m);
  assert.ok(
    core.includes(
      'Done when: `node tools/verify.mjs --only rust:fmt,rust:clippy,rust:test && npx vitest run src/ipc/mock/threads.test.ts` is green',
    ),
  );
  const ui = compose({ part: 'ui', item: { ...ITEM, tests } });
  assert.match(ui, /^Scope: pass 2 of 2 \(E12\)/m);
  assert.ok(ui.includes('.autopilot/items/F-04.3/impl-core.json'));
  assert.ok(ui.includes('Done when: `node tools/verify.mjs` is green'));
  assert.equal(
    coreVerifyCommand(['src-tauri/src/store/state_tests.rs', 'tests/e2e/step.spec.ts']),
    'node tools/verify.mjs --only rust:fmt,rust:clippy,rust:test',
  );
  assert.equal(
    coreVerifyCommand(['src\\ipc\\tauri.test.ts']),
    'node tools/verify.mjs --only rust:fmt,rust:clippy,rust:test && npx vitest run src/ipc/tauri.test.ts',
  );
});

test('autopilot prompt: fix problems come from the last failed gate, else the review', () => {
  const gates = [
    { pass: false, checks: [{ name: 'verify', ok: false, detail: 'FAIL test\n  x.test.ts' }] },
    {
      pass: false,
      checks: [
        { name: 'clean', ok: true },
        { name: 'rules', ok: false, detail: 'unwrap() in src-tauri/src/a.rs' },
      ],
    },
  ];
  assert.equal(
    fixProblems({ review: REVIEW, gates }),
    '- gate check rules failed:\n    unwrap() in src-tauri/src/a.rs',
  );
  assert.equal(fixProblems({ review: { findings: [REVIEW.findings[1]] }, gates: [] }), '');
  assert.deepEqual(offeredIds('# x\n## Files\n- [P-009] not offered\n'), []);
  assert.equal(verifyCommand(['src/a.test.ts'], 1510), 'node tools/verify.mjs');
});

test('autopilot prompt: a missing required field is an error', () => {
  const compose = (name, over) => () =>
    composePrompt(COMMON, role(name), promptValues(args(name, over)));
  const unlocked = { ...ITEM, lockSha: undefined, tests: undefined };
  assert.throws(compose('implement', { item: unlocked }), /empty fields: tests$/);
  assert.throws(compose('tests', { files: {} }), /empty fields: context$/);
  assert.throws(compose('review', { run: null }), /empty fields: runId$/);
  assert.throws(
    compose('reflect', { item: { ...ITEM, status: 'review' } }),
    /empty fields: result$/,
  );
  assert.throws(
    compose('fix', { files: { context: CONTEXT, gates: [{ pass: true, checks: [] }] } }),
    /problems/,
  );
  assert.throws(compose('curate', { run: null }), /empty fields: runId, milestone$/);
  assert.throws(compose('live', { live: [ITEM] }), /empty fields: checks$/);
  assert.throws(compose('plan', { id: undefined }), /empty fields: .*milestone/);
  assert.throws(compose('implement', { extra: { verify: ' ' } }), /empty fields: verify$/);
  assert.doesNotThrow(compose('fix', { files: { context: CONTEXT }, extra: { problems: '- x' } }));
});

test('autopilot prompt: the CLI prints the prompt or exits 1 on an empty field', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gr prompt ł-'));
  try {
    mkdirSync(join(dir, 'docs', 'process'), { recursive: true });
    mkdirSync(join(dir, '.autopilot', 'items', 'F-04.3'), { recursive: true });
    const backlog = {
      milestone: 'M3',
      items: [ITEM, { ...ITEM, id: 'F-04.4', tests: [] }, { ...LIVE, note: '' }],
    };
    writeFileSync(join(dir, 'docs', 'process', 'backlog.json'), JSON.stringify(backlog));
    writeFileSync(join(dir, '.autopilot', 'run.json'), JSON.stringify(args('tests').run));
    writeFileSync(join(dir, '.autopilot', 'items', 'F-04.3', 'context.md'), CONTEXT);
    const cli = (...a) =>
      spawnSync(process.execPath, [PROMPT, ...a, '--root', dir, '--extra', '{"base":"m3-x"}'], {
        encoding: 'utf8',
      });
    const ok = cli('implement', 'F-04.3');
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /branch ap\/f04-3 from m3-x/);
    assert.match(ok.stdout, /gr prompt ł-[^/]*\/\.autopilot\/items\/F-04\.3\/context\.md/);
    const empty = cli('implement', 'F-04.4');
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /empty fields: context, tests/);
    const live = cli('live');
    assert.equal(live.status, 0, live.stderr);
    assert.match(live.stdout, /^- F-09\.6 Notes appear progressively\.$/m);
    assert.equal(cli('nope', 'F-04.3').status, 2);
    assert.match(cli('tests', 'F-09.9').stderr, /no item F-09\.9/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('autopilot prompt: tests, implement and fix start from the item note and earlier attempts', () => {
  const dir = 'C:\\Repos\\guided review ł\\.autopilot\\items\\F-04.3';
  const attempts = [
    {
      n: 2,
      dir: `${dir}\\attempt-2`,
      impl: { complete: false, partialReason: 'needs a live check in tauri dev' },
      gates: [{ pass: true, merged: '9163bf3' }],
    },
    {
      n: 1,
      dir: `${dir}\\attempt-1`,
      impl: { complete: true },
      review: { findings: [{ severity: 'severe' }, { severity: 'nit' }] },
      fixes: 1,
      gates: [
        {
          pass: false,
          checks: [
            { name: 'clean', ok: true },
            { name: 'locked-tests', ok: false },
          ],
        },
        { pass: true, merged: 'abc1234' },
      ],
    },
  ];
  const note = 'live check failed: S-03 shows "Couldn\'t analyze this step."';
  assert.equal(
    itemHistory({ note, attempts }),
    [
      `- Item note: ${note}`,
      '- Attempt 1 (verdicts in C:/Repos/guided review ł/.autopilot/items/F-04.3/attempt-1/): implement complete; review 1 severe, 0 normal; 1 fix round; gate failed (locked-tests), then passed (merged abc1234)',
      '- Attempt 2 (verdicts in C:/Repos/guided review ł/.autopilot/items/F-04.3/attempt-2/): implement partial: needs a live check in tauri dev; gate passed (merged 9163bf3)',
    ].join('\n'),
  );
  assert.equal(itemHistory({ note: ' ', attempts: [] }), 'none: first attempt, no note');
  const files = { context: CONTEXT, review: REVIEW, attempts };
  for (const name of ['tests', 'implement', 'fix']) {
    const repeat = composePrompt(
      COMMON,
      role(name),
      promptValues(args(name, { item: { ...ITEM, note }, files })),
    );
    assert.match(repeat, /^- Item note: live check failed: S-03 shows/m, name);
    assert.match(repeat, /^- Attempt 2 \(verdicts in C:\/Repos\/guided review ł\/.*attempt-2\/\)/m);
    const first = composePrompt(COMMON, role(name), promptValues(args(name)));
    assert.match(first, /^none: first attempt, no note$/m, name);
  }
  const review = composePrompt(COMMON, role('review'), promptValues(args('review', { files })));
  assert.doesNotMatch(review, /Item note|first attempt/);
  const live = composePrompt(
    COMMON,
    role('reflect'),
    promptValues(args('reflect', { item: { ...ITEM, status: 'live' } })),
  );
  assert.match(live, /result live\)/);
});

test('autopilot prompt: the CLI reads the attempt-N folders of the item', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gr prompt ł-'));
  try {
    const items = join(dir, '.autopilot', 'items', 'F-04.3');
    mkdirSync(join(items, 'attempt-1'), { recursive: true });
    mkdirSync(join(dir, 'docs', 'process'), { recursive: true });
    const note = 'live check failed: S-03 stays empty';
    writeFileSync(
      join(dir, 'docs', 'process', 'backlog.json'),
      JSON.stringify({ milestone: 'M3', items: [{ ...ITEM, status: 'impl', note }] }),
    );
    writeFileSync(join(dir, '.autopilot', 'run.json'), JSON.stringify(args('tests').run));
    writeFileSync(join(items, 'context.md'), CONTEXT);
    writeFileSync(join(items, 'attempt-1', 'impl.json'), JSON.stringify({ complete: true }));
    const failed = { pass: false, checks: [{ name: 'verify', ok: false, detail: 'FAIL e2e' }] };
    writeFileSync(join(items, 'attempt-1', 'gate-1.json'), JSON.stringify(failed));
    writeFileSync(join(items, 'attempt-1', 'gate-2.json'), JSON.stringify({ pass: true }));
    const r = spawnSync(
      process.execPath,
      [PROMPT, 'implement', 'F-04.3', '--root', dir, '--extra', '{"base":"m3-x"}'],
      { encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^- Item note: live check failed: S-03 stays empty$/m);
    assert.match(
      r.stdout,
      /^- Attempt 1 \(verdicts in .*gr prompt ł-[^/]*\/\.autopilot\/items\/F-04\.3\/attempt-1\/\): implement complete; gate failed \(verify\), then passed$/m,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('autopilot prompt E17: the reflector gets the existing lessons of the item kind and files', () => {
  const entry = (id, tags, text) => ({ id, tags, text, helpful: 0, harmful: 0, seen: 1 });
  const playbook = {
    items: 3,
    entries: [
      entry('P-001', ['ui', 'implement'], 'One lesson.'),
      entry('P-002', ['ui', 'tests', 'tests/e2e/**'], 'Assert the screen, not the URL.'),
      entry('P-003', ['core', 'fix', 'src/a.ts'], 'Map store errors.'),
      entry('P-004', ['core', 'review'], 'Not for this item.'),
    ],
  };
  assert.deepEqual(contextFiles(CONTEXT), ['src/a.ts']);
  assert.deepEqual(contextFiles('# x\n## Playbook\n- [P-001] y\n'), []);
  const reflect = composePrompt(
    COMMON,
    role('reflect'),
    promptValues(args('reflect', { item: { ...ITEM, kind: 'ui' }, playbook })),
  );
  assert.match(reflect, /^- \[P-001\] One lesson\.$/m);
  assert.match(reflect, /^- \[P-002\] Assert the screen/m);
  assert.match(reflect, /^- \[P-003\] Map store errors\.$/m);
  assert.doesNotMatch(reflect, /P-004/);
  assert.match(reflect, /"same": "P-003"/);
  const none = composePrompt(COMMON, role('reflect'), promptValues(args('reflect')));
  assert.match(none, /its files \(id and text\):\nnone\n/);
});

test('autopilot prompt E22: tests ahead are written in ../gr-ap-2 on port 1511 from the item before', async () => {
  const ahead = composePrompt(
    COMMON,
    role('tests'),
    promptValues(args('tests', { wt: 'C:\\Repos\\gr-ap-2', ahead: 'F-04.2' })),
  );
  assert.match(
    ahead,
    /Worktree C:\/Repos\/gr-ap-2, branch ap\/f04-3 from ap\/f04-2\. Mock dev server and e2e port: 1511\./,
  );
  assert.match(
    ahead,
    /^- Tests ahead: ap\/f04-3 starts from ap\/f04-2, where F-04\.2 is implemented and still in review .*; m3-plan-focus is merged in before the implementer of F-04\.3 starts\./m,
  );
  assert.match(ahead, /GR_PORT=1511/);
  assert.doesNotMatch(ahead, /1510/);
  const own = composePrompt(COMMON, role('tests'), promptValues(args('tests')));
  assert.match(own, /a spec of this criterion's own, `tests\/e2e\/<screen>-f04-3\.spec\.ts`/);
  assert.match(own, /branch ap\/f04-3 from m3-plan-focus\. Mock dev server and e2e port: 1510\./);
  assert.doesNotMatch(own, /Tests ahead/);

  const dir = mkdtempSync(join(tmpdir(), 'gr prompt ł-'));
  try {
    mkdirSync(join(dir, 'docs', 'process'), { recursive: true });
    mkdirSync(join(dir, '.autopilot', 'items', 'F-04.3'), { recursive: true });
    const backlog = { milestone: 'M3', items: [{ ...ITEM, status: 'todo' }] };
    writeFileSync(join(dir, 'docs', 'process', 'backlog.json'), JSON.stringify(backlog));
    writeFileSync(join(dir, '.autopilot', 'run.json'), JSON.stringify(args('tests').run));
    writeFileSync(join(dir, '.autopilot', 'items', 'F-04.3', 'context.md'), CONTEXT);
    const cli = (...a) =>
      spawnSync(process.execPath, [PROMPT, ...a, '--root', dir, '--extra', '{"base":"m3-x"}'], {
        encoding: 'utf8',
      });
    const ok = cli('tests', 'F-04.3', '--ahead', 'F-04.2');
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Worktree [^\n]*\/gr-ap-2, branch ap\/f04-3 from ap\/f04-2\./);
    const wrong = cli('implement', 'F-04.3', '--ahead', 'F-04.2');
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /--ahead is only for the tests role/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
