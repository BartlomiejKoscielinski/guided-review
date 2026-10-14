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
  fields,
  fixProblems,
  offeredIds,
  promptValues,
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
  assert.throws(compose('plan', { id: undefined }), /empty fields: .*milestone/);
  assert.throws(compose('implement', { extra: { verify: ' ' } }), /empty fields: verify$/);
  assert.doesNotThrow(compose('fix', { files: { context: CONTEXT }, extra: { problems: '- x' } }));
});

test('autopilot prompt: the CLI prints the prompt or exits 1 on an empty field', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gr prompt ł-'));
  try {
    mkdirSync(join(dir, 'docs', 'process'), { recursive: true });
    mkdirSync(join(dir, '.autopilot', 'items', 'F-04.3'), { recursive: true });
    const backlog = { milestone: 'M3', items: [ITEM, { ...ITEM, id: 'F-04.4', tests: [] }] };
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
    assert.equal(cli('nope', 'F-04.3').status, 2);
    assert.match(cli('tests', 'F-09.9').stderr, /no item F-09\.9/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
