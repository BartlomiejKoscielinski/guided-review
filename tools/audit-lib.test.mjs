// Self-test for tools/audit-lib.mjs. Run: node --test "tools/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSpecIds,
  parseProgress,
  parseManualChecklist,
  isTestFile,
  extractTestRefs,
  rustTestNames,
  buildRows,
  isFailing,
} from './audit-lib.mjs';

const moduleFile = `
//! Coverage invariant. F-06.99 in a module doc comment is not a test reference.
pub fn coverage() {}

/// Mentions F-06.98 but is not a test.
fn helper_f06_97() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn f06_10_missing_hunks_go_to_other_step() {}

    #[test]
    #[should_panic(expected = "boom")]
    fn f06_4_strategy_toggle_reorders() {}

    #[tokio::test(flavor = "multi_thread")]
    async fn nfr08_redacts_tokens_and_auth_headers() {}

    // a comment between the attribute and the fn
    #[test]
    // explains the case
    pub(crate) fn coverage_keeps_f05_07_file_level_hunks_and_f05_3_ids() {}

    #[test]
    fn plain_name_without_id() {}
}
`;

test('finds #[test] functions inside a module file', () => {
  assert.deepEqual(rustTestNames(moduleFile), [
    'f06_10_missing_hunks_go_to_other_step',
    'f06_4_strategy_toggle_reorders',
    'nfr08_redacts_tokens_and_auth_headers',
    'coverage_keeps_f05_07_file_level_hunks_and_f05_3_ids',
    'plain_name_without_id',
  ]);
});

test('maps Rust test names with a suffix to spec IDs', () => {
  assert.deepEqual(extractTestRefs('src-tauri/src/review/coverage.rs', moduleFile), [
    'F-06.10',
    'F-06.4',
    'NFR-08',
    'F-05.7',
    'F-05.3',
  ]);
});

test('ignores IDs outside test function names in Rust files', () => {
  const ids = extractTestRefs('src-tauri/src/review/coverage.rs', moduleFile);
  for (const id of ['F-06.99', 'F-06.98', 'F-06.97']) assert.ok(!ids.includes(id), id);
});

test('reads Rust integration tests in src-tauri/tests', () => {
  const text = '#[test]\nfn f16_2_index_is_the_checkbox_state() {}\n';
  assert.deepEqual(extractTestRefs('src-tauri/tests/staging.rs', text), ['F-16.2']);
});

test('reads IDs from Vitest and Playwright test titles', () => {
  const text = `
    it('F-06.10 missing hunks go to the Other step', () => {});
    test('F-06.1 header shows the MR title; NFR-06 focus ring', () => {});
    // XF-01.1 is not an ID
  `;
  assert.deepEqual(extractTestRefs('src/screens/plan/Plan.test.tsx', text), [
    'F-06.10',
    'F-06.1',
    'NFR-06',
  ]);
  assert.deepEqual(extractTestRefs('tests/e2e/plan.spec.ts', "test('F-07.1 layouts')"), ['F-07.1']);
});

test('only test files count for TS/JS', () => {
  assert.equal(isTestFile('src/screens/plan/Plan.tsx'), false);
  assert.equal(isTestFile('src/latest.ts'), false);
  assert.equal(isTestFile('src/screens/plan/Plan.test.tsx'), true);
  assert.equal(isTestFile('tests/e2e/shell.spec.ts'), true);
  assert.equal(isTestFile('src-tauri/src/error.rs'), true);
  assert.deepEqual(extractTestRefs('src/screens/plan/Plan.tsx', "'F-06.1'"), []);
});

test('builds rows and fails on ticked items without evidence', () => {
  const specIds = parseSpecIds(
    '- **F-06.4** Strategy\n- **F-06.10** Coverage\n- **NFR-08** Privacy\n',
  );
  assert.deepEqual(specIds, ['F-06.4', 'F-06.10', 'NFR-08']);
  const progressItems = parseProgress(
    '## M3 · Plan\n- [x] F-06.4 Strategy (a1b2c3d)\n- [x] F-06.10 Coverage\n## M0 · X\n- [ ] NFR-08 Privacy\n',
  );
  const manual = parseManualChecklist('- [ ] NFR-08 Logs checked by hand\n');
  const refs = new Map([['F-06.4', new Set(['src-tauri/src/review/plan.rs'])]]);
  const rows = buildRows({ specIds, progressItems, refs, manual });
  assert.deepEqual(
    rows.map((r) => [r.id, r.milestone, r.problems]),
    [
      ['F-06.4', 'M3', []],
      ['F-06.10', 'M3', ['ticked without commit SHA', 'ticked without test or manual check']],
      ['NFR-08', 'M0', []],
    ],
  );
  assert.equal(isFailing(rows), true);
  assert.equal(
    isFailing(buildRows({ specIds, progressItems, refs, manual, onlyMilestone: 'M0' })),
    false,
  );
});
