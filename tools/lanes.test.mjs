import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContextPack,
  globToRegExp,
  laneBranch,
  outsideOwns,
  overlaps,
  ownsRust,
  parseId,
  pickPort,
  section,
} from './lanes-lib.mjs';

const product = [
  '# 01 · Product',
  '## Feature catalog',
  '### F-06 Review plan · S-02',
  '- **F-06.9** Threads are shown read-only.',
  '### F-07 Step review · S-03',
  '- **F-07.1** Three layouts (ADR-018).',
  '- **F-07.2** Step header; see F-10 and M3 decision 8.',
  '### F-08 Detailed mode · S-04',
  '- **F-08.1** Not wanted.',
  '## Non-functional requirements',
].join('\n');
const screens = [
  '# 02 · Screens',
  '## S-03 Step review',
  '- Mock: `Review.dc.html`',
  '## S-04 Detailed',
  '- other',
].join('\n');
const design = [
  '| S-03 Focus | `Review.dc.html` | `{}` (A) |',
  '| S-04 Detailed | `Main.dc.html` | `{}` |',
  '| `Review.dc.html` | "Finish" → "Finish review" | `S03-focus-layout-A.png` |',
].join('\n');
const progress = [
  '- [x] F-07.1 Three layouts (abc1234)',
  '- [ ] F-07.2 Step header — partial: UI',
  '- [ ] F-08.1 x',
].join('\n');
const plan = [
  '## AC → build → test',
  '| F-07.1 | layouts in one store | Vitest |',
  '| F-07.2 | header (decision 4) | e2e |',
  '| F-08.1 | detailed | e2e |',
  '## Decisions (approved)',
  '',
  '1. **Unrelated.** No.',
  '4. **Answers.** Card style.',
  '8. **Detailed toggle.** Shown.',
  '## Order of work',
].join('\n');
const docs = { product, screens, design, progress, plan };
const pngs = ['S03-focus-layout-A.png', 'S04-detailed.png'];

test('parseId accepts features, criteria and screens in loose forms', () => {
  assert.deepEqual(parseId('F-07'), { kind: 'F', num: '07', ac: null });
  assert.deepEqual(parseId('f7.3'), { kind: 'F', num: '07', ac: '3' });
  assert.deepEqual(parseId('S03'), { kind: 'S', num: '03', ac: null });
  assert.equal(parseId('S-03.1'), null);
  assert.equal(parseId('ADR-018'), null);
});

test('section stops at the next heading of the same or a higher level', () => {
  assert.equal(section(product, /^### F-07 /).split('\n').length, 3);
  assert.equal(section(screens, /^## S-03 /), '## S-03 Step review\n- Mock: `Review.dc.html`');
  assert.equal(section(product, /^### F-99 /), null);
});

test('E4 context pack: feature, its PROGRESS lines, screen with mock, PNGs and pending re-renders', () => {
  const pack = buildContextPack({ lane: 'focus', rawIds: ['F-07', 'S-03'], docs, pngs, files: [] });
  assert.deepEqual(pack.missing, []);
  assert.match(pack.text, /\*\*F-07\.1\*\*[\s\S]*\*\*F-07\.2\*\*/);
  assert.doesNotMatch(pack.text, /F-08\.1|S-04|Main\.dc\.html/);
  assert.match(pack.text, /Status in docs\/PROGRESS\.md:\n- \[x\] F-07\.1[^\n]*\n- \[ \] F-07\.2/);
  assert.match(pack.text, /### S-03 Step review/);
  assert.match(pack.text, /Mock: docs\/design\/mocks\/Review\.dc\.html/);
  assert.match(pack.text, /PNGs: docs\/design\/screens\/S03-focus-layout-A\.png\n/);
  assert.match(pack.text, /Pending re-renders[^\n]*\n\| `Review\.dc\.html` \| "Finish"/);
  assert.match(pack.text, /ADR-018 · F-10 · M3 decision 8/);
  assert.ok(pack.tokens > pack.sections.reduce((n, s) => n + s.tokens, 0));
});

test('E4 context pack: a criterion ID keeps only that criterion; unknown IDs are reported', () => {
  const pack = buildContextPack({ lane: 'x', rawIds: ['F-07.2', 'F-42', 'ADR-1'], docs, pngs });
  assert.match(pack.text, /\*\*F-07\.2\*\*/);
  assert.doesNotMatch(pack.text, /F-07\.1/);
  assert.deepEqual(pack.missing.sort(), ['ADR-1', 'F-42']);
});

test('E4 context pack: --plan adds the plan rows and the decisions mentioned, drops them from pointers', () => {
  const pack = buildContextPack({ lane: 'x', rawIds: ['F-07'], docs, milestone: 'M3', pngs });
  assert.match(pack.text, /\| F-07\.1 \| layouts[^\n]*\n\| F-07\.2 \| header/);
  assert.doesNotMatch(pack.text, /F-08\.1 \| detailed|Unrelated/);
  assert.match(pack.text, /M3 decisions:\n\n4\. \*\*Answers\.\*\*[^\n]*\n8\. \*\*Detailed toggle/);
  assert.doesNotMatch(pack.text, /Mentioned[\s\S]*M3 decision 8/);
});

test('E4 context pack: files show their size or that they are new', () => {
  const files = [
    { path: 'src/a.ts', lines: 12 },
    { path: 'src/b.ts', lines: null },
  ];
  const pack = buildContextPack({ lane: 'x', rawIds: ['S-03'], docs, pngs, files });
  assert.match(pack.text, /- src\/a\.ts \(12 lines\)\n- src\/b\.ts \(new\)/);
});

test('globs: *, **, ? and a trailing slash for a whole directory', () => {
  assert.ok(globToRegExp('src/screens/review/**').test('src/screens/review/a/B.tsx'));
  assert.ok(globToRegExp('src/screens/review/').test('src/screens/review/B.tsx'));
  assert.ok(globToRegExp('src/**/*.test.ts').test('src/a.test.ts'));
  assert.ok(globToRegExp('src/**/*.test.ts').test('src/x/y/a.test.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/x/a.ts'));
  assert.ok(globToRegExp('migrations/00?_x.sql').test('migrations/007_x.sql'));
  assert.ok(!globToRegExp('a.b').test('axb'));
});

test('ownership: files outside the globs and files touched by two lanes', () => {
  const owns = ['src/screens/review/**', 'tests/e2e/step.spec.ts'];
  assert.deepEqual(
    outsideOwns(['src/screens/review/A.tsx', 'tests/e2e/step.spec.ts', 'src\\ipc\\tauri.ts'], owns),
    ['src\\ipc\\tauri.ts'],
  );
  assert.deepEqual(overlaps({ a: ['x', 'y'], b: ['y', 'z'], c: ['y'] }), [['y', ['a', 'b', 'c']]]);
});

test('pickPort skips ports of other lanes and busy ports', async () => {
  assert.equal(await pickPort(new Set([1421]), async (p) => p === 1422), 1423);
  assert.equal(await pickPort(new Set(), async () => true), null);
});

test('E4 lanes: only globs reaching src-tauri/ build Rust; the branch follows the milestone', () => {
  assert.ok(ownsRust(['src/**', 'src-tauri/src/review/**']));
  assert.ok(ownsRust(['src-tauri\\src\\store\\']));
  assert.ok(ownsRust(['**/*.rs']));
  assert.ok(!ownsRust(['src/screens/step/**', 'tests/e2e/step*', 'docs/**']));
  assert.equal(laneBranch('m3-plan-focus', 'trial'), 'm3/trial');
  assert.equal(laneBranch('M12/x', 'trial'), 'm12/trial');
  assert.equal(laneBranch('main', 'trial'), null);
});
